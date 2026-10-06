import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.serialization.JsonOps;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.function.BiConsumer;
import java.util.function.Predicate;
import net.minecraft.SharedConstants;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Holder;
import net.minecraft.core.registries.Registries;
import net.minecraft.tags.TagKey;
import net.minecraft.tags.TagLoader;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.Bootstrap;
import net.minecraft.tags.BlockTags;
import net.minecraft.util.RandomSource;
import net.minecraft.world.level.WorldGenLevel;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.RotatedPillarBlock;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.levelgen.LegacyRandomSource;
import net.minecraft.world.level.levelgen.feature.TreeFeature;
import net.minecraft.world.level.levelgen.feature.foliageplacers.FoliagePlacer;
import net.minecraft.world.level.material.FluidState;

/**
 * Grows each tree config in configs.json with Minecraft's own trunk and foliage placers, the way TreeFeature
 * does in open air on flat grass at y 64, and records each tree as a SHA-1 of its sorted blocks ("x,y,z,log:y"
 * lines, y relative to the sapling). The Mod Creator preview (treegen.ts) must grow exactly the same blocks;
 * packages/core/test/treegen.test.ts checks it against this output, kept in test/fixtures/vanilla-trees.json.
 * See README.md here for how to run it.
 *
 * Usage: java -cp <minecraft jar + its libraries> TreeParity.java configs.json <seeds> out.json
 */
public class TreeParity {
	static final int BASE_Y = 64;

	public static void main(String[] args) throws Exception {
		SharedConstants.tryDetectVersion();
		Bootstrap.bootStrap();
		// Without a data pack no block tags are bound; bind the three tree code checks to our test blocks.
		Map<TagKey<Block>, List<Holder<Block>>> tags = Map.of(
				BlockTags.LOGS, List.of(BuiltInRegistries.BLOCK.wrapAsHolder(Blocks.OAK_LOG)),
				BlockTags.LEAVES, List.of(BuiltInRegistries.BLOCK.wrapAsHolder(Blocks.OAK_LEAVES)),
				BlockTags.REPLACEABLE_BY_TREES, List.of(BuiltInRegistries.BLOCK.wrapAsHolder(Blocks.OAK_LEAVES)));
		BuiltInRegistries.BLOCK.prepareTagReload(new TagLoader.LoadResult<>(Registries.BLOCK, tags)).apply();

		JsonObject configs = JsonParser.parseString(Files.readString(Path.of(args[0]))).getAsJsonObject();
		int seeds = Integer.parseInt(args[1]);
		JsonObject trees = new JsonObject();
		for (Map.Entry<String, JsonElement> e : configs.entrySet()) {
			JsonObject json = e.getValue().getAsJsonObject().deepCopy();
			json.add("trunk_provider", JsonParser.parseString("{\"id\":\"minecraft:oak_log\",\"properties\":{\"axis\":\"y\"}}"));
			json.add("foliage_provider", JsonParser.parseString("{\"id\":\"minecraft:oak_leaves\"}"));
			json.add("below_trunk_provider", JsonParser.parseString("{\"id\":\"minecraft:dirt\"}"));
			json.add("decorators", new JsonArray());
			TreeFeature tree = TreeFeature.CODEC.codec().parse(JsonOps.INSTANCE, json).getOrThrow();
			JsonArray hashes = new JsonArray();
			for (int seed = 0; seed < seeds; seed++) hashes.add(grow(tree, seed));
			trees.add(e.getKey(), hashes);
		}
		// Minecraft redirects System.out into its log, so write the result to a file.
		JsonObject out = new JsonObject();
		out.addProperty("about", "Trees grown by Minecraft 26.3's own code (scripts/tree-parity). Seed n is trees[name][n].");
		out.add("configs", configs);
		out.add("trees", trees);
		Files.writeString(Path.of(args[2]), new GsonBuilder().setPrettyPrinting().disableHtmlEscaping().create().toJson(out) + "\n");
	}

	/** TreeFeature.doPlace in an empty world: no clipping, no roots, no decorators. */
	static String grow(TreeFeature tree, long seed) {
		Map<BlockPos, BlockState> world = new HashMap<>();
		Set<BlockPos> foliage = new HashSet<>();
		WorldGenLevel level = fakeLevel(world);
		RandomSource random = new LegacyRandomSource(seed);
		BiConsumer<BlockPos, BlockState> trunkSetter = (pos, state) -> world.put(pos.immutable(), state);
		FoliagePlacer.FoliageSetter foliageSetter = new FoliagePlacer.FoliageSetter() {
			@Override
			public void set(BlockPos pos, BlockState state) {
				foliage.add(pos.immutable());
				world.put(pos.immutable(), state);
			}

			@Override
			public boolean isSet(BlockPos pos) {
				return foliage.contains(pos);
			}
		};
		int treeHeight = tree.trunkPlacer().getTreeHeight(random);
		int foliageHeight = tree.foliagePlacer().foliageHeight(random, treeHeight, tree);
		int leafRadius = tree.foliagePlacer().foliageRadius(random, treeHeight - foliageHeight);
		BlockPos origin = new BlockPos(0, BASE_Y, 0);
		for (FoliagePlacer.FoliageAttachment a : tree.trunkPlacer().placeTrunk(level, trunkSetter, random, treeHeight, origin, tree)) {
			tree.foliagePlacer().createFoliage(level, foliageSetter, random, tree, treeHeight, a, foliageHeight, leafRadius);
		}
		// Sorted, so the output is stable.
		TreeMap<String, String> sorted = new TreeMap<>();
		for (Map.Entry<BlockPos, BlockState> e : world.entrySet()) {
			BlockPos p = e.getKey();
			BlockState s = e.getValue();
			String kind = s.is(Blocks.OAK_LOG) ? "log:" + s.getValue(RotatedPillarBlock.AXIS).getSerializedName()
					: s.is(Blocks.OAK_LEAVES) ? "leaves" : "soil";
			sorted.put(String.format("%d,%d,%d", p.getX(), p.getY() - BASE_Y, p.getZ()), kind);
		}
		StringBuilder lines = new StringBuilder();
		sorted.forEach((k, v) -> lines.append(k).append(',').append(v).append('\n'));
		return hash(lines.toString());
	}

	/** SHA-1 of a tree's sorted block lines, to keep the fixture small. */
	static String hash(String text) {
		try {
			return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-1").digest(text.getBytes(StandardCharsets.UTF_8)));
		} catch (Exception e) {
			throw new RuntimeException(e);
		}
	}

	/** Air above y 64, grass below, plus whatever the tree has placed. */
	@SuppressWarnings("unchecked")
	static WorldGenLevel fakeLevel(Map<BlockPos, BlockState> world) {
		return (WorldGenLevel) Proxy.newProxyInstance(TreeParity.class.getClassLoader(), new Class<?>[] {WorldGenLevel.class}, (proxy, method, a) -> {
			switch (method.getName()) {
				case "getBlockState": return stateAt(world, (BlockPos) a[0]);
				case "isStateAtPosition": return ((Predicate<BlockState>) a[1]).test(stateAt(world, (BlockPos) a[0]));
				case "isFluidAtPosition": return ((Predicate<FluidState>) a[1]).test(stateAt(world, (BlockPos) a[0]).getFluidState());
				case "getFluidState": return stateAt(world, (BlockPos) a[0]).getFluidState();
				case "hashCode": return System.identityHashCode(proxy);
				case "equals": return proxy == a[0];
				case "toString": return "FakeLevel";
				default: throw new UnsupportedOperationException("tree code called level." + method.getName());
			}
		});
	}

	static BlockState stateAt(Map<BlockPos, BlockState> world, BlockPos pos) {
		BlockState s = world.get(pos);
		if (s != null) return s;
		return pos.getY() < BASE_Y ? Blocks.GRASS_BLOCK.defaultBlockState() : Blocks.AIR.defaultBlockState();
	}
}
