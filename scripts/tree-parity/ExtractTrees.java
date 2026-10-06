import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.mojang.serialization.JsonOps;
import java.lang.reflect.Field;
import java.lang.reflect.Proxy;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import net.minecraft.SharedConstants;
import net.minecraft.core.Holder;
import net.minecraft.core.HolderGetter;
import net.minecraft.core.HolderOwner;
import net.minecraft.core.HolderSet;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.data.worldgen.BootstrapContext;
import net.minecraft.data.worldgen.features.TreeFeatures;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.Bootstrap;
import net.minecraft.tags.TagKey;
import net.minecraft.world.level.levelgen.feature.Feature;
import net.minecraft.world.level.levelgen.feature.TreeFeature;
import net.minecraft.world.level.levelgen.feature.featuresize.FeatureSize;
import net.minecraft.world.level.levelgen.feature.foliageplacers.CherryFoliagePlacer;
import net.minecraft.world.level.levelgen.feature.foliageplacers.FoliagePlacer;
import net.minecraft.world.level.levelgen.feature.trunkplacers.TrunkPlacer;

/**
 * Reads Minecraft's own tree configs out of the jar (TreeFeatures, the code that builds the vanilla trees) and
 * writes the trunk placer, foliage placer and minimum size of each shape Mod Creator offers to
 * packages/core/src/profiles/v26_3/vanillaTrees.json. Rerun it against a new Minecraft version's jar and the
 * shapes follow; TreeParity.java then checks the preview still grows them right.
 *
 * Usage: java -cp <minecraft jar + its libraries> ExtractTrees.java out.json
 */
public class ExtractTrees {
	/** Mod Creator's shape name -> the vanilla feature it copies. */
	static final Map<String, String> SHAPES = new LinkedHashMap<>();
	static {
		SHAPES.put("oak", "oak");
		SHAPES.put("fancy_oak", "fancy_oak");
		SHAPES.put("birch", "birch");
		SHAPES.put("super_birch", "super_birch_bees_0002");
		SHAPES.put("jungle", "jungle_tree_no_vine");
		SHAPES.put("swamp_oak", "swamp_oak");
		SHAPES.put("jungle_bush", "jungle_bush");
		SHAPES.put("spruce", "spruce");
		SHAPES.put("pine", "pine");
		SHAPES.put("acacia", "acacia");
		SHAPES.put("cherry", "cherry");
		SHAPES.put("azalea", "azalea_tree");
		SHAPES.put("poplar", "red_poplar");
		SHAPES.put("dark_oak", "dark_oak");
		SHAPES.put("mega_spruce", "mega_spruce");
		SHAPES.put("mega_pine", "mega_pine");
		SHAPES.put("mega_jungle", "mega_jungle_tree");
	}

	@SuppressWarnings({"unchecked", "rawtypes"})
	public static void main(String[] args) throws Exception {
		SharedConstants.tryDetectVersion();
		Bootstrap.bootStrap();
		Map<String, Feature> features = new LinkedHashMap<>();
		HolderOwner owner = new HolderOwner() {};
		// Lookups hand out unbound references: the tree shapes only need the placers, not the blocks they name.
		HolderGetter getter = (HolderGetter) Proxy.newProxyInstance(ExtractTrees.class.getClassLoader(), new Class<?>[] {HolderGetter.class}, (p, m, a) -> switch (m.getName()) {
			case "get" -> a[0] instanceof TagKey tag ? Optional.of(HolderSet.emptyNamed(owner, tag)) : Optional.of(Holder.Reference.createStandAlone(owner, (ResourceKey) a[0]));
			case "getOrThrow" -> a[0] instanceof TagKey tag ? HolderSet.emptyNamed(owner, tag) : Holder.Reference.createStandAlone(owner, (ResourceKey) a[0]);
			case "hashCode" -> System.identityHashCode(p);
			case "equals" -> p == a[0];
			default -> throw new UnsupportedOperationException(m.getName());
		});
		BootstrapContext<Feature> context = (BootstrapContext<Feature>) Proxy.newProxyInstance(ExtractTrees.class.getClassLoader(), new Class<?>[] {BootstrapContext.class}, (p, m, a) -> switch (m.getName()) {
			case "register" -> {
				ResourceKey<Feature> key = (ResourceKey<Feature>) a[0];
				features.put(key.identifier().getPath(), (Feature) a[1]);
				yield Holder.Reference.createStandAlone(owner, key);
			}
			case "lookup" -> getter;
			default -> throw new UnsupportedOperationException(m.getName());
		});
		TreeFeatures.bootstrap(context);

		JsonObject out = new JsonObject();
		out.addProperty("about", "Read from Minecraft " + SharedConstants.getCurrentVersion().name() + "'s TreeFeatures by scripts/tree-parity/ExtractTrees.java. Don't edit by hand.");
		JsonObject shapes = new JsonObject();
		for (Map.Entry<String, String> e : SHAPES.entrySet()) {
			if (!(features.get(e.getValue()) instanceof TreeFeature tree)) throw new IllegalStateException("No vanilla tree " + e.getValue() + " in this version");
			JsonObject shape = new JsonObject();
			shape.add("trunk_placer", encode(TrunkPlacer.CODEC, tree.trunkPlacer()));
			JsonObject foliage = encode(FoliagePlacer.CODEC, tree.foliagePlacer()).getAsJsonObject();
			if (tree.foliagePlacer() instanceof CherryFoliagePlacer cherry) {
				// The game's codec writes corner_hole_chance from the wrong field (wide_bottom_layer_hole_chance's), so
				// a data file would get 0.25 where vanilla's own cherry uses 0.5. Take the real value.
				Field corner = CherryFoliagePlacer.class.getDeclaredField("cornerHoleChance");
				corner.setAccessible(true);
				foliage.addProperty("corner_hole_chance", corner.getFloat(cherry));
			}
			shape.add("foliage_placer", foliage);
			shape.add("minimum_size", encode(FeatureSize.CODEC, tree.minimumSize()));
			shapes.add(e.getKey(), shape);
		}
		out.add("shapes", shapes);
		Files.writeString(Path.of(args[0]), new GsonBuilder().setPrettyPrinting().disableHtmlEscaping().create().toJson(out) + "\n");
	}

	static <T> JsonElement encode(com.mojang.serialization.Codec<T> codec, T value) {
		return codec.encodeStart(JsonOps.INSTANCE, value).getOrThrow();
	}
}
