// Reads every vanilla mob model and AI goal out of a Minecraft client jar, for Mod Creator's mob editor.
//
// Run by scripts/extract-vanilla.mjs with the client jar and its libraries on the classpath:
//   java -cp <jars> scripts/vanilla/ExtractVanilla.java <out.json>
//
// Nothing here is hand-written per mob or per goal: models come from LayerDefinitions and the renderers that bake
// them, goals from the classes in the jar, so a new Minecraft version is picked up by running it again.

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.lang.classfile.ClassFile;
import java.lang.classfile.ClassModel;
import java.lang.classfile.CodeElement;
import java.lang.classfile.CodeModel;
import java.lang.classfile.Instruction;
import java.lang.classfile.MethodModel;
import java.lang.classfile.Opcode;
import java.lang.classfile.TypeKind;
import java.lang.classfile.instruction.ConstantInstruction;
import java.lang.classfile.instruction.FieldInstruction;
import java.lang.classfile.instruction.InvokeDynamicInstruction;
import java.lang.classfile.instruction.InvokeInstruction;
import java.lang.classfile.instruction.LoadInstruction;
import java.lang.classfile.instruction.NewObjectInstruction;
import java.lang.constant.ClassDesc;
import java.lang.constant.DirectMethodHandleDesc;
import java.lang.constant.MethodTypeDesc;
import java.lang.reflect.Constructor;
import java.lang.reflect.Executable;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.Type;
import java.lang.reflect.TypeVariable;
import java.lang.reflect.WildcardType;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import javax.imageio.ImageIO;

import net.minecraft.SharedConstants;
import net.minecraft.client.model.geom.LayerDefinitions;
import net.minecraft.client.model.geom.ModelLayerLocation;
import net.minecraft.client.model.geom.ModelLayers;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.model.geom.PartPose;
import net.minecraft.client.model.geom.builders.CubeDefinition;
import net.minecraft.client.model.geom.builders.CubeDeformation;
import net.minecraft.client.model.geom.builders.LayerDefinition;
import net.minecraft.client.model.geom.builders.PartDefinition;
import net.minecraft.client.model.geom.builders.UVPair;
import net.minecraft.client.renderer.entity.state.LivingEntityRenderState;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.Bootstrap;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.ai.goal.Goal;

public class ExtractVanilla {
	static final String MODEL_PART = "Lnet/minecraft/client/model/geom/ModelPart;";
	static final ClassLoader LOADER = ExtractVanilla.class.getClassLoader();
	static ZipFile jar;

	public static void main(String[] args) throws Exception {
		SharedConstants.tryDetectVersion();
		Bootstrap.bootStrap();
		jar = new ZipFile(jarOf(LayerDefinitions.class));

		JsonObject out = new JsonObject();
		out.addProperty("version", SharedConstants.getCurrentVersion().name());
		out.add("models", models());
		out.add("goals", goals());
		out.add("entities", entities());
		JsonObject bases = new JsonObject();
		bases.add("animal", supertypes(net.minecraft.world.entity.animal.Animal.class));
		bases.add("tameable", supertypes(net.minecraft.world.entity.TamableAnimal.class));
		bases.add("hostile", supertypes(net.minecraft.world.entity.monster.Monster.class));
		out.add("bases", bases);

		Gson gson = new GsonBuilder().disableHtmlEscaping().create();
		Files.writeString(Path.of(args[0]), gson.toJson(out));
		System.out.println("Wrote " + out.getAsJsonObject("models").size() + " models and " + out.getAsJsonObject("goals").size() + " goals to " + args[0]);
		System.exit(0);
	}

	static String jarOf(Class<?> c) throws Exception {
		return Path.of(c.getProtectionDomain().getCodeSource().getLocation().toURI()).toString();
	}

	static List<String> classNames(String prefix) {
		List<String> names = new ArrayList<>();
		jar.stream().map(ZipEntry::getName).filter(n -> n.startsWith(prefix) && n.endsWith(".class")).forEach(n -> names.add(n.substring(0, n.length() - 6)));
		Collections.sort(names);
		return names;
	}

	static ClassModel parse(String internalName) {
		try {
			ZipEntry e = jar.getEntry(internalName + ".class");
			if (e == null) return null;
			return ClassFile.of().parse(jar.getInputStream(e).readAllBytes());
		} catch (IOException ex) {
			throw new RuntimeException(ex);
		}
	}

	static Class<?> load(String binaryName) {
		try {
			return Class.forName(binaryName, false, LOADER);
		} catch (Throwable t) {
			return null;
		}
	}

	static String dotted(ClassDesc d) {
		String s = d.descriptorString();
		return s.substring(1, s.length() - 1).replace('/', '.');
	}

	static double round(double v) {
		return Math.round(v * 10000) / 10000.0;
	}

	// ---------------------------------------------------------------- models

	record Bake(String renderer, List<String> entities, String layer, String model) {}

	// Values the bake tracer follows through a method: a ModelLayers constant, a layer parameter, a baked part.
	record LayerTok(String name) {}
	record ParamTok(int index) {}
	record BakedTok(Object from) {}
	/** A `new Model(...)`; `from` is filled in once its constructor gets a baked layer. */
	static final class NewTok {
		final String cls;
		Object from;
		NewTok(String cls) { this.cls = cls; }
	}
	static final Object OTHER = new Object();

	record LayerUse(String inClass, String inMethod, String layer, String callee, int arg) {}
	record ParamPass(String caller, int param, String callee, int arg) {}

	/** Layers whose model is handed to a render layer (saddles, armor, eyes...), not used as a mob's body. */
	static final Set<String> OVERLAY_LAYERS = new HashSet<>();
	static final Set<String> BODY_LAYERS = new HashSet<>();
	/** Methods whose layer parameter ends up in a render layer, or in a body. */
	static final Map<String, Set<Integer>> OVERLAY_PARAMS = new HashMap<>(), BODY_PARAMS = new HashMap<>();
	/** Renderer class -> models it builds from a layer the tracer couldn't follow (kept in enums and fields). */
	static final Map<String, List<String>> UNTRACED = new HashMap<>();

	/**
	 * Every layer a renderer bakes into a model, read from bytecode. Layers often travel through constructor
	 * parameters (`super(context, ModelLayers.ZOMBIE, ...)` then `new ZombieModel(context.bakeLayer(layer))`), so
	 * this traces them across calls.
	 */
	static List<Bake> bakes() throws Exception {
		Map<String, Map<Integer, Set<String>>> paramModels = new HashMap<>();
		List<LayerUse> uses = new ArrayList<>();
		List<ParamPass> passes = new ArrayList<>();
		List<LayerUse> direct = new ArrayList<>(); // callee = model class
		for (String name : classNames("net/minecraft/client/")) {
			ClassModel cm = parse(name);
			for (MethodModel m : cm.methods()) {
				if (m.code().isEmpty()) continue;
				String key = name + "." + m.methodName().stringValue() + m.methodType().stringValue();
				traceLayers(name, m, key, paramModels, uses, passes, direct);
			}
		}
		for (boolean changed = true; changed; ) {
			changed = false;
			for (ParamPass p : passes) {
				Set<String> models = paramModels.getOrDefault(p.callee(), Map.of()).get(p.arg());
				if (models == null) continue;
				changed |= paramModels.computeIfAbsent(p.caller(), k -> new HashMap<>()).computeIfAbsent(p.param(), k -> new LinkedHashSet<>()).addAll(models);
			}
		}
		for (var flags : List.of(OVERLAY_PARAMS, BODY_PARAMS)) {
			for (boolean changed = true; changed; ) {
				changed = false;
				for (ParamPass p : passes) {
					if (flags.getOrDefault(p.callee(), Set.of()).contains(p.arg())) changed |= flags.computeIfAbsent(p.caller(), k -> new HashSet<>()).add(p.param());
				}
			}
			for (LayerUse u : uses) {
				if (flags.getOrDefault(u.callee(), Set.of()).contains(u.arg())) (flags == OVERLAY_PARAMS ? OVERLAY_LAYERS : BODY_LAYERS).add(u.layer());
			}
		}
		Map<String, String> lambdaEntities = lambdaEntities();
		List<Bake> found = new ArrayList<>();
		List<LayerUse> all = new ArrayList<>(direct);
		for (LayerUse u : uses) {
			for (String model : paramModels.getOrDefault(u.callee(), Map.of()).getOrDefault(u.arg(), Set.of())) {
				all.add(new LayerUse(u.inClass(), u.inMethod(), u.layer(), model, -1));
			}
		}
		for (LayerUse u : all) {
			String renderer = u.inClass().replace('/', '.');
			List<String> entities = new ArrayList<>();
			if (renderer.equals("net.minecraft.client.renderer.entity.EntityRenderers")) {
				String method = u.inMethod().substring(u.inMethod().indexOf('.') + 1, u.inMethod().indexOf('('));
				if (lambdaEntities.containsKey(method)) entities.add(lambdaEntities.get(method));
				List<String> built = constructedRenderers(parse(u.inClass()), method);
				renderer = built.isEmpty() ? renderer : built.get(0);
			}
			int dollar = renderer.indexOf('$');
			if (dollar > 0) renderer = renderer.substring(0, dollar);
			// Only a renderer's own body: layers baked by render layers are overlays (wool, armor, saddles...).
			Class<?> rc = load(renderer);
			if (rc == null || !net.minecraft.client.renderer.entity.LivingEntityRenderer.class.isAssignableFrom(rc)) continue;
			found.add(new Bake(renderer, entities, u.layer(), u.callee().replace('/', '.')));
		}
		return found;
	}

	static void traceLayers(String owner, MethodModel m, String key, Map<String, Map<Integer, Set<String>>> paramModels, List<LayerUse> uses, List<ParamPass> passes, List<LayerUse> direct) {
		boolean isStatic = (m.flags().flagsMask() & ClassFile.ACC_STATIC) != 0;
		MethodTypeDesc type = m.methodTypeSymbol();
		Map<Integer, Object> locals = new HashMap<>();
		int slot = isStatic ? 0 : 1;
		for (int i = 0; i < type.parameterCount(); i++) {
			if (type.parameterType(i).descriptorString().equals("Lnet/minecraft/client/model/geom/ModelLayerLocation;")) locals.put(slot, new ParamTok(i));
			slot += TypeKind.from(type.parameterType(i)).slotSize();
		}
		Deque<Object> stack = new ArrayDeque<>();
		java.util.function.Supplier<Object> pop = () -> stack.isEmpty() ? OTHER : stack.pop();
		for (CodeElement el : m.code().get()) {
			if (!(el instanceof Instruction ins)) continue;
			if (ins instanceof LoadInstruction l) {
				stack.push(locals.getOrDefault(l.slot(), OTHER));
			} else if (ins instanceof java.lang.classfile.instruction.StoreInstruction st) {
				locals.put(st.slot(), pop.get());
			} else if (ins instanceof FieldInstruction f) {
				switch (f.opcode()) {
					case GETSTATIC -> stack.push(f.owner().asInternalName().equals("net/minecraft/client/model/geom/ModelLayers") && f.typeSymbol().descriptorString().endsWith("ModelLayerLocation;") ? new LayerTok(f.name().stringValue()) : OTHER);
					case GETFIELD -> { pop.get(); stack.push(OTHER); }
					case PUTFIELD -> { pop.get(); pop.get(); }
					default -> pop.get();
				}
			} else if (ins instanceof InvokeInstruction inv) {
				MethodTypeDesc t = inv.typeSymbol();
				Object[] args = new Object[t.parameterCount()];
				for (int i = args.length - 1; i >= 0; i--) args[i] = pop.get();
				Object popped = inv.opcode() != Opcode.INVOKESTATIC ? pop.get() : OTHER;
				String callee = inv.owner().asInternalName() + "." + inv.name().stringValue() + t.descriptorString();
				if (inv.name().equalsString("bakeLayer") && args.length == 1) {
					stack.push(new BakedTok(args[0]));
					continue;
				}
				Object receiver = OTHER;
				if (inv.opcode() != Opcode.INVOKESTATIC) receiver = popped;
				if (inv.name().equalsString("<init>") && t.descriptorString().matches("\\(" + java.util.regex.Pattern.quote(MODEL_PART) + "Z*\\)V") && args[0] instanceof BakedTok b) {
					if (b.from() instanceof LayerTok lt) direct.add(new LayerUse(owner, key, lt.name(), inv.owner().asInternalName(), -1));
					else if (b.from() instanceof ParamTok pt) paramModels.computeIfAbsent(key, k -> new HashMap<>()).computeIfAbsent(pt.index(), k -> new LinkedHashSet<>()).add(inv.owner().asInternalName());
					else add(UNTRACED, owner.replace('/', '.'), inv.owner().asInternalName().replace('/', '.'));
					if (receiver instanceof NewTok nt) nt.from = b.from();
					continue;
				}
				// A built model handed on: to a render layer it's an overlay, to anything else (the renderer's
				// super constructor, a baby/adult pair) it's a body.
				if (inv.name().equalsString("<init>")) {
					Class<?> target = load(inv.owner().asInternalName().replace('/', '.'));
					boolean overlay = target != null && net.minecraft.client.renderer.entity.layers.RenderLayer.class.isAssignableFrom(target);
					for (Object a : args) {
						if (!(a instanceof NewTok nt)) continue;
						if (nt.from instanceof LayerTok lt) (overlay ? OVERLAY_LAYERS : BODY_LAYERS).add(lt.name());
						if (nt.from instanceof ParamTok pt) (overlay ? OVERLAY_PARAMS : BODY_PARAMS).computeIfAbsent(key, k -> new HashSet<>()).add(pt.index());
					}
				}
				for (int i = 0; i < args.length; i++) {
					if (args[i] instanceof LayerTok lt) uses.add(new LayerUse(owner, key, lt.name(), callee, i));
					if (args[i] instanceof ParamTok pt) passes.add(new ParamPass(key, pt.index(), callee, i));
				}
				if (!t.returnType().descriptorString().equals("V")) stack.push(OTHER);
			} else if (ins instanceof InvokeDynamicInstruction indy) {
				for (int i = 0; i < indy.typeSymbol().parameterCount(); i++) pop.get();
				stack.push(OTHER);
			} else if (ins instanceof NewObjectInstruction n) {
				stack.push(new NewTok(n.className().asInternalName()));
			} else if (ins instanceof ConstantInstruction) {
				stack.push(OTHER);
			} else {
				switch (ins.opcode()) {
					case DUP -> stack.push(stack.isEmpty() ? OTHER : stack.peek());
					case POP, IFEQ, IFNE, IFLT, IFGE, IFGT, IFLE, IFNULL, IFNONNULL, ATHROW, MONITORENTER, MONITOREXIT -> pop.get();
					case IF_ICMPEQ, IF_ICMPNE, IF_ICMPLT, IF_ICMPGE, IF_ICMPGT, IF_ICMPLE, IF_ACMPEQ, IF_ACMPNE -> { pop.get(); pop.get(); }
					case AASTORE, IASTORE, FASTORE -> { pop.get(); pop.get(); pop.get(); }
					case AALOAD -> { pop.get(); pop.get(); stack.push(OTHER); }
					case ANEWARRAY, NEWARRAY, ARRAYLENGTH, INSTANCEOF -> { pop.get(); stack.push(OTHER); }
					case CHECKCAST, NOP, GOTO, GOTO_W, I2F, I2D, F2D, D2F, F2I, D2I -> {}
					case RETURN, ARETURN, IRETURN, FRETURN, DRETURN, LRETURN -> stack.clear();
					default -> {
						// Arithmetic and the rest: layers never pass through them.
						var k = ins.opcode().name();
						if (k.matches("[DFIL](ADD|SUB|MUL|DIV|REM|AND|OR|XOR|SHL|SHR|USHR)|[DFL]CMP[LG]?")) { pop.get(); pop.get(); stack.push(OTHER); }
						else if (k.matches("[DFIL]NEG|[IL]2[IFDL]|I2[BCS]")) {}
						else stack.clear();
					}
				}
			}
		}
	}

	/** EntityRenderers' register lambdas: lambda method name -> entity id. */
	static Map<String, String> lambdaEntities() throws Exception {
		Map<String, String> out = new HashMap<>();
		ClassModel cm = parse("net/minecraft/client/renderer/entity/EntityRenderers");
		for (MethodModel m : cm.methods()) {
			if (m.code().isEmpty()) continue;
			String type = null;
			for (CodeElement el : m.code().get()) {
				if (el instanceof FieldInstruction f && f.opcode() == Opcode.GETSTATIC && f.typeSymbol().descriptorString().equals("Lnet/minecraft/world/entity/EntityType;")) {
					type = entityId(f.owner().asInternalName(), f.name().stringValue());
				} else if (el instanceof InvokeDynamicInstruction indy && type != null) {
					for (var arg : indy.bootstrapArgs()) {
						if (arg instanceof DirectMethodHandleDesc mh && !mh.methodName().equals("<init>")) out.put(mh.methodName(), type);
					}
					type = null;
				}
			}
		}
		return out;
	}

	/** Entity type ids each renderer draws, from `EntityRenderers.register(EntityTypes.X, XRenderer::new)`. */
	static Map<String, List<String>> rendererEntities() throws Exception {
		Map<String, List<String>> out = new HashMap<>();
		ClassModel cm = parse("net/minecraft/client/renderer/entity/EntityRenderers");
		for (MethodModel m : cm.methods()) {
			if (m.code().isEmpty()) continue;
			String type = null;
			for (CodeElement el : m.code().get()) {
				if (el instanceof FieldInstruction f && f.opcode() == Opcode.GETSTATIC && f.typeSymbol().descriptorString().equals("Lnet/minecraft/world/entity/EntityType;")) {
					type = entityId(f.owner().asInternalName(), f.name().stringValue());
				} else if (el instanceof InvokeDynamicInstruction indy && type != null) {
					for (var arg : indy.bootstrapArgs()) {
						if (arg instanceof DirectMethodHandleDesc mh) {
							if (mh.methodName().equals("<init>")) add(out, dotted(mh.owner()), type);
							else for (String r : constructedRenderers(cm, mh.methodName())) add(out, r, type);
						}
					}
					type = null;
				}
			}
		}
		return out;
	}

	static void add(Map<String, List<String>> map, String key, String value) {
		List<String> list = map.computeIfAbsent(key, k -> new ArrayList<>());
		if (value != null && !list.contains(value)) list.add(value);
	}

	static List<String> constructedRenderers(ClassModel cm, String method) {
		List<String> out = new ArrayList<>();
		for (MethodModel m : cm.methods()) {
			if (!m.methodName().equalsString(method) || m.code().isEmpty()) continue;
			for (CodeElement el : m.code().get()) {
				if (el instanceof NewObjectInstruction n) out.add(n.className().asInternalName().replace('/', '.'));
			}
		}
		return out;
	}

	static String entityId(String owner, String field) throws Exception {
		Object type = Class.forName(owner.replace('/', '.')).getField(field).get(null);
		return BuiltInRegistries.ENTITY_TYPE.getKey((EntityType<?>) type).toString();
	}

	/** `textures/entity/...` paths a renderer (or its inner classes) names. */
	static List<String> rendererTextures(String renderer) {
		List<String> out = new ArrayList<>();
		String base = renderer.replace('.', '/');
		for (String name : classNames(base)) {
			if (!name.equals(base) && !name.startsWith(base + "$")) continue;
			for (MethodModel m : parse(name).methods()) {
				if (m.code().isEmpty()) continue;
				for (CodeElement el : m.code().get()) {
					if (el instanceof ConstantInstruction.LoadConstantInstruction c && c.constantValue() instanceof String s && s.startsWith("textures/entity/")) {
						out.add("assets/minecraft/" + s);
					}
				}
			}
		}
		return out;
	}

	/** Shadow radius the renderer passes to its superclass, if it's a plain constant. */
	static Float rendererShadow(String renderer) {
		ClassModel cm = parse(renderer.replace('.', '/'));
		if (cm == null) return null;
		String superName = cm.superclass().map(s -> s.asInternalName()).orElse("");
		for (MethodModel m : cm.methods()) {
			if (!m.methodName().equalsString("<init>") || m.code().isEmpty()) continue;
			Float last = null;
			for (CodeElement el : m.code().get()) {
				if (el instanceof ConstantInstruction c && c.constantValue() instanceof Float f) last = f;
				if (el instanceof InvokeInstruction inv && inv.name().equalsString("<init>") && inv.owner().asInternalName().equals(superName)) {
					if (last != null) return last;
				}
			}
		}
		return null;
	}

	static int[] imageSize(String path) {
		try {
			ZipEntry e = jar.getEntry(path);
			if (e == null) return null;
			var img = ImageIO.read(jar.getInputStream(e));
			return img == null ? null : new int[] {img.getWidth(), img.getHeight()};
		} catch (IOException ex) {
			return null;
		}
	}

	/** The render state class a model's setupAnim takes, resolved through its generic superclasses. */
	static Class<?> renderState(Class<?> model) {
		Map<TypeVariable<?>, Type> bound = new HashMap<>();
		Class<?> c = model;
		while (c != null && c != Object.class) {
			Type sup = c.getGenericSuperclass();
			if (sup instanceof ParameterizedType pt) {
				Class<?> raw = (Class<?>) pt.getRawType();
				TypeVariable<?>[] vars = raw.getTypeParameters();
				for (int i = 0; i < vars.length; i++) {
					Type a = pt.getActualTypeArguments()[i];
					while (a instanceof TypeVariable<?> tv && bound.containsKey(tv)) a = bound.get(tv);
					bound.put(vars[i], a);
				}
				if (raw.getName().equals("net.minecraft.client.model.EntityModel")) {
					Type s = bound.get(vars[0]);
					if (s instanceof Class<?> sc) return sc;
					if (s instanceof TypeVariable<?> tv && tv.getBounds()[0] instanceof Class<?> bc) return bc;
					return null;
				}
			}
			c = c.getSuperclass();
		}
		return null;
	}

	/** The render state a mob renderer would hand this model: its own, or a living one if it takes any entity's. */
	static Class<?> rendererState(Class<?> model) {
		Class<?> s = renderState(model);
		if (s == null || !Modifier.isPublic(s.getModifiers())) return null;
		if (LivingEntityRenderState.class.isAssignableFrom(s)) return s;
		return s.isAssignableFrom(LivingEntityRenderState.class) ? LivingEntityRenderState.class : null;
	}

	static Class<?> commonModel(Class<?> a, Class<?> b) {
		for (Class<?> c = a; c != null; c = c.getSuperclass()) {
			if (c.isAssignableFrom(b)) return c;
		}
		return null;
	}

	static JsonObject models() throws Exception {
		Map<ModelLayerLocation, LayerDefinition> roots = LayerDefinitions.createRoots();
		Map<String, ModelLayerLocation> layers = new TreeMap<>();
		for (Field f : ModelLayers.class.getFields()) {
			if (f.getType() == ModelLayerLocation.class) layers.put(f.getName(), (ModelLayerLocation) f.get(null));
		}
		Map<String, List<String>> entities = rendererEntities();

		// layer -> (model class, renderers that bake it)
		Map<String, String> layerModel = new TreeMap<>();
		Map<String, List<String>> layerRenderers = new HashMap<>();
		Map<String, List<String>> layerEntities = new HashMap<>();
		for (Bake b : bakes()) {
			layerModel.putIfAbsent(b.layer(), b.model());
			add(layerRenderers, b.layer(), b.renderer());
			for (String e : b.entities()) add(layerEntities, b.layer(), e);
		}
		// Layers kept in enums or fields (donkey, mule, undead horses): match the layer named after an entity with the
		// models that entity's renderer builds.
		for (var r : entities.entrySet()) {
			List<String> built = UNTRACED.getOrDefault(r.getKey(), List.of());
			if (built.isEmpty()) continue;
			for (String e : r.getValue()) {
				String path = e.substring(e.indexOf(':') + 1);
				for (var l : layers.entrySet()) {
					if (!l.getValue().model().getPath().equals(path) || !l.getValue().layer().equals("main") || layerModel.containsKey(l.getKey())) continue;
					String adult = built.stream().filter(c -> !c.substring(c.lastIndexOf('.') + 1).startsWith("Baby")).findFirst().orElse(null);
					if (adult == null) continue;
					layerModel.put(l.getKey(), adult);
					BODY_LAYERS.add(l.getKey());
					add(layerRenderers, l.getKey(), r.getKey());
					String baby = built.stream().filter(c -> c.substring(c.lastIndexOf('.') + 1).startsWith("Baby")).findFirst().orElse(null);
					if (baby != null && layers.containsKey(l.getKey() + "_BABY")) layerModel.putIfAbsent(l.getKey() + "_BABY", baby);
				}
			}
		}

		JsonObject out = new JsonObject();
		for (var entry : layerModel.entrySet()) {
			String layer = entry.getKey();
			if (layer.endsWith("_BABY") && layerModel.containsKey(layer.substring(0, layer.length() - 5))) continue;
			Class<?> model = load(entry.getValue());
			if (model == null || !Modifier.isPublic(model.getModifiers()) || Modifier.isAbstract(model.getModifiers())) continue;
			if (OVERLAY_LAYERS.contains(layer) && !BODY_LAYERS.contains(layer)) continue;
			Class<?> state = rendererState(model);
			if (state == null) continue;
			LayerDefinition def = roots.get(layers.get(layer));
			if (def == null) continue;

			JsonObject m = new JsonObject();
			m.addProperty("layer", layer);
			m.addProperty("model", model.getName());
			if (modelFlags(model) > 0) m.addProperty("flags", modelFlags(model));
			if (model.getTypeParameters().length > 0) m.addProperty("generic", true);
			m.addProperty("state", state.getName());
			List<String> renderers = layerRenderers.get(layer);
			List<String> ents = new ArrayList<>(layerEntities.getOrDefault(layer, List.of()));
			for (String r : renderers) ents.addAll(entities.getOrDefault(r, List.of()));
			m.add("entities", strings(ents));
			// The first entity's own ambient, hurt and death sounds, where it has them.
			JsonObject sounds = new JsonObject();
			for (String e : ents) {
				String path = e.substring(e.indexOf(':') + 1);
				for (String k : List.of("ambient", "hurt", "death")) {
					var key = net.minecraft.resources.Identifier.withDefaultNamespace("entity." + path + "." + k);
					if (!sounds.has(k) && BuiltInRegistries.SOUND_EVENT.containsKey(key)) sounds.addProperty(k, key.toString());
				}
				if (sounds.size() > 0) break;
			}
			if (sounds.size() > 0) m.add("sounds", sounds);
			if (!ents.isEmpty()) {
				EntityType<?> et = BuiltInRegistries.ENTITY_TYPE.getValue(net.minecraft.resources.Identifier.parse(ents.get(0)));
				m.add("size", nums(et.getWidth(), et.getHeight()));
			}
			Float shadow = null;
			for (String r : renderers) if ((shadow = rendererShadow(r)) != null) break;
			if (shadow != null) m.addProperty("shadow", round(shadow));

			JsonObject adult = geometry(def, model, state);
			if (adult == null) continue; // setupAnim fails on a fresh render state, so the renderer can't use it either
			m.add("adult", adult);
			String babyLayer = layer + "_BABY";
			if (layerModel.containsKey(babyLayer) && roots.containsKey(layers.get(babyLayer))) {
				Class<?> babyModel = load(layerModel.get(babyLayer));
				Class<?> common = babyModel == null ? null : commonModel(model, babyModel);
				if (common != null && rendererState(babyModel) == state && Modifier.isPublic(babyModel.getModifiers())) {
					JsonObject baby = geometry(roots.get(layers.get(babyLayer)), babyModel, state);
					if (baby != null) {
						m.addProperty("babyLayer", babyLayer);
						m.addProperty("babyModel", babyModel.getName());
						m.addProperty("modelType", common.getName());
						if (babyModel.getTypeParameters().length > 0) m.addProperty("babyGeneric", true);
						if (common.getTypeParameters().length > 0) m.addProperty("modelTypeGeneric", true);
						m.add("baby", baby);
					}
				}
			}

			// A vanilla texture to show until the mod has its own: one the renderer names whose size fits the model.
			int tw = adult.getAsJsonArray("textureSize").get(0).getAsInt(), th = adult.getAsJsonArray("textureSize").get(1).getAsInt();
			List<String> candidates = new ArrayList<>();
			for (String r : renderers) candidates.addAll(rendererTextures(r));
			List<String> named = new ArrayList<>(ents);
			named.add(layers.get(layer).model().getPath());
			for (String e : named) {
				String path = e.substring(e.indexOf(':') + 1);
				for (String n : List.of("assets/minecraft/textures/entity/" + path + "/" + path + ".png", "assets/minecraft/textures/entity/" + path + ".png")) candidates.add(n);
				jar.stream().map(ZipEntry::getName).filter(n -> n.startsWith("assets/minecraft/textures/entity/" + path + "/") && n.endsWith(".png"))
						.sorted(Comparator.comparing((String n) -> !n.contains("temperate")).thenComparing(String::length).thenComparing(n -> n)).forEach(candidates::add);
			}
			for (String c : candidates) {
				int[] size = imageSize(c);
				if (size != null && size[0] * th == size[1] * tw) {
					m.addProperty("texture", c.substring("assets/minecraft/".length()));
					break;
				}
			}

			String id = layers.get(layer).model().getPath();
			if (!layers.get(layer).layer().equals("main")) id += "_" + layers.get(layer).layer();
			if (out.has(id)) id = layer.toLowerCase(Locale.ROOT);
			out.add(id, m);
		}
		return out;
	}

	static JsonArray strings(Collection<String> values) {
		JsonArray a = new JsonArray();
		new LinkedHashSet<>(values).forEach(a::add);
		return a;
	}

	static <T> T get(Object o, String field) {
		try {
			Field f = o.getClass().getDeclaredField(field);
			f.setAccessible(true);
			@SuppressWarnings("unchecked") T t = (T) f.get(o);
			return t;
		} catch (ReflectiveOperationException e) {
			throw new RuntimeException(e);
		}
	}

	static JsonArray nums(double... v) {
		JsonArray a = new JsonArray();
		for (double d : v) {
			double r = round(d);
			if (r == Math.rint(r) && Math.abs(r) < 1e9) a.add((long) r);
			else a.add(r);
		}
		return a;
	}

	static JsonArray pose(float x, float y, float z, float xr, float yr, float zr, float xs, float ys, float zs) {
		return (xs == 1 && ys == 1 && zs == 1) ? nums(x, y, z, xr, yr, zr) : nums(x, y, z, xr, yr, zr, xs, ys, zs);
	}

	static JsonObject part(String name, PartDefinition def) {
		JsonObject p = new JsonObject();
		p.addProperty("name", name);
		PartPose pp = get(def, "partPose");
		p.add("pose", pose(pp.x(), pp.y(), pp.z(), pp.xRot(), pp.yRot(), pp.zRot(), pp.xScale(), pp.yScale(), pp.zScale()));
		JsonArray cubes = new JsonArray();
		List<CubeDefinition> list = get(def, "cubes");
		for (CubeDefinition c : list) {
			JsonObject cube = new JsonObject();
			org.joml.Vector3fc o = get(c, "origin"), d = get(c, "dimensions");
			CubeDeformation g = get(c, "grow");
			UVPair uv = get(c, "texCoord"), scale = get(c, "texScale");
			cube.add("box", nums(o.x(), o.y(), o.z(), d.x(), d.y(), d.z()));
			cube.add("uv", nums(uv.u(), uv.v()));
			float gx = get(g, "growX"), gy = get(g, "growY"), gz = get(g, "growZ");
			if (gx != 0 || gy != 0 || gz != 0) cube.add("grow", nums(gx, gy, gz));
			if ((boolean) get(c, "mirror")) cube.addProperty("mirror", true);
			if (scale.u() != 1 || scale.v() != 1) cube.add("uvScale", nums(scale.u(), scale.v()));
			Set<?> faces = get(c, "visibleFaces");
			if (faces.size() != 6) {
				JsonArray fa = new JsonArray();
				for (Object f : faces) fa.add(f.toString().toLowerCase(Locale.ROOT));
				cube.add("faces", fa);
			}
			cubes.add(cube);
		}
		if (!cubes.isEmpty()) p.add("cubes", cubes);
		JsonArray children = new JsonArray();
		for (var e : def.getChildren()) children.add(part(e.getKey(), e.getValue()));
		if (!children.isEmpty()) p.add("children", children);
		return p;
	}

	/**
	 * A layer's parts and texture size, plus how the vanilla model poses them: at rest and over one walk cycle,
	 * sampled by running its setupAnim. Null if setupAnim throws on a plain render state.
	 */
	static JsonObject geometry(LayerDefinition def, Class<?> modelClass, Class<?> stateClass) {
		JsonObject g = new JsonObject();
		Object material = get(def, "material");
		g.add("textureSize", nums((int) get(material, "xTexSize"), (int) get(material, "yTexSize")));
		PartDefinition root = ((net.minecraft.client.model.geom.builders.MeshDefinition) get(def, "mesh")).getRoot();
		g.add("root", part("root", root));
		try {
			Object model = newModel(modelClass, def.bakeRoot());
			Method setup = null;
			for (Method mm : modelClass.getMethods()) {
				if (mm.getName().equals("setupAnim") && mm.getParameterCount() == 1 && mm.getParameterTypes()[0].isAssignableFrom(stateClass)) setup = mm;
			}
			ModelPart modelRoot = (ModelPart) modelClass.getMethod("root").invoke(model);
			Method reset = modelClass.getMethod("resetPose");
			// The walk cycle of most mobs is cos(pos * 0.6662), about 9.43 blocks walked.
			int frames = 12;
			double cycle = 2 * Math.PI / 0.6662;
			Map<String, double[]> rest = null;
			JsonArray walk = new JsonArray();
			for (int i = -1; i < frames; i++) {
				LivingEntityRenderState state = (LivingEntityRenderState) stateClass.getConstructor().newInstance();
				state.ageInTicks = i < 0 ? 0 : (float) (i * cycle / frames);
				state.walkAnimationPos = i < 0 ? 0 : (float) (i * cycle / frames);
				state.walkAnimationSpeed = i < 0 ? 0 : 1;
				state.scale = 1;
				state.ageScale = 1;
				reset.invoke(model);
				if (setup != null) setup.invoke(model, state);
				Map<String, double[]> poses = new LinkedHashMap<>();
				readPoses("", modelRoot, poses);
				if (i < 0) {
					rest = poses;
					JsonObject r = new JsonObject();
					for (var e : poses.entrySet()) r.add(e.getKey(), nums(e.getValue()));
					g.add("rest", r);
				} else {
					JsonObject f = new JsonObject();
					for (var e : poses.entrySet()) {
						if (!Arrays.equals(e.getValue(), rest.get(e.getKey()))) f.add(e.getKey(), nums(e.getValue()));
					}
					walk.add(f);
				}
			}
			boolean moves = false;
			for (var f : walk) moves |= !f.getAsJsonObject().isEmpty();
			if (moves) g.add("walk", walk);
			return g;
		} catch (Throwable t) {
			System.err.println("skip " + modelClass.getName() + ": " + t);
			return null;
		}
	}

	/** Builds a model from its part; models that also take flags (the player's slim arms) get false. */
	static Object newModel(Class<?> modelClass, ModelPart part) throws ReflectiveOperationException {
		for (Constructor<?> k : modelClass.getConstructors()) {
			Class<?>[] p = k.getParameterTypes();
			if (p.length == 0 || p[0] != ModelPart.class || !Arrays.stream(p).skip(1).allMatch(c -> c == boolean.class)) continue;
			Object[] args = new Object[p.length];
			args[0] = part;
			Arrays.fill(args, 1, args.length, false);
			return k.newInstance(args);
		}
		throw new NoSuchMethodException(modelClass.getName() + "(ModelPart)");
	}

	/** How many false flags follow the part in the model's constructor. */
	static int modelFlags(Class<?> modelClass) {
		for (Constructor<?> k : modelClass.getConstructors()) {
			Class<?>[] p = k.getParameterTypes();
			if (p.length > 0 && p[0] == ModelPart.class && Arrays.stream(p).skip(1).allMatch(c -> c == boolean.class)) return p.length - 1;
		}
		return -1;
	}

	static void readPoses(String path, ModelPart part, Map<String, double[]> out) {
		double[] p = {part.x, part.y, part.z, part.xRot, part.yRot, part.zRot, part.xScale, part.yScale, part.zScale, part.visible && !part.skipDraw ? 1 : 0};
		for (int i = 0; i < p.length; i++) p[i] = round(p[i]);
		if (!path.isEmpty()) out.put(path, p);
		Map<String, ModelPart> children = get(part, "children");
		for (var e : children.entrySet()) readPoses(path.isEmpty() ? e.getKey() : path + "/" + e.getKey(), e.getValue(), out);
	}

	// ---------------------------------------------------------------- goals

	/** Every public goal class with a public constructor: its constructors and builder-style setters. */
	static JsonObject goals() {
		JsonObject out = new JsonObject();
		for (String name : classNames("net/minecraft/")) {
			if (name.contains("$") || !name.endsWith("Goal")) continue;
			Class<?> c = load(name.replace('/', '.'));
			if (c == null || !Goal.class.isAssignableFrom(c) || !Modifier.isPublic(c.getModifiers()) || Modifier.isAbstract(c.getModifiers())) continue;
			JsonArray ctors = new JsonArray();
			Constructor<?>[] ks = c.getConstructors();
			Arrays.sort(ks, Comparator.comparing(Constructor::toGenericString));
			for (Constructor<?> k : ks) {
				JsonObject sig = signature(c, k);
				if (sig.has("mobBounds")) ctors.add(sig);
			}
			if (ctors.isEmpty()) continue;
			JsonObject g = new JsonObject();
			g.addProperty("class", c.getName());
			if (c.getTypeParameters().length > 0) g.addProperty("generic", true);
			g.addProperty("target", net.minecraft.world.entity.ai.goal.target.TargetGoal.class.isAssignableFrom(c));
			g.add("constructors", ctors);
			JsonArray setters = new JsonArray();
			Method[] ms = c.getMethods();
			Arrays.sort(ms, Comparator.comparing(Method::toGenericString));
			for (Method m : ms) {
				if (Modifier.isStatic(m.getModifiers()) || m.getName().startsWith("get") || !m.getReturnType().isAssignableFrom(c) || !Goal.class.isAssignableFrom(m.getReturnType())) continue;
				setters.add(signature(m.getDeclaringClass(), m));
			}
			if (!setters.isEmpty()) g.add("setters", setters);
			out.add(c.getSimpleName(), g);
		}
		return out;
	}

	static JsonObject signature(Class<?> owner, Executable e) {
		JsonObject s = new JsonObject();
		if (e instanceof Method m) s.addProperty("name", m.getName());
		List<String> names = paramNames(owner, e);
		JsonArray params = new JsonArray();
		Type[] types = e.getGenericParameterTypes();
		for (int i = 0; i < types.length; i++) {
			JsonObject p = new JsonObject();
			p.addProperty("name", names.get(i));
			String type = paramType(types[i], e.isVarArgs() && i == types.length - 1);
			p.addProperty("type", type);
			// What a Class<...> parameter accepts, like Animal for BreedGoal's partner class.
			if (type.equals("entityClass") && types[i] instanceof ParameterizedType pt) {
				Class<?> bound = raw(pt.getActualTypeArguments()[0]);
				if (bound != Object.class) p.addProperty("bound", bound.getName());
			}
			if (e instanceof Constructor<?> && isMobType(raw(types[i])) && !s.has("mobBounds")) s.add("mobBounds", strings(bounds(types[i])));
			params.add(p);
		}
		s.add("params", params);
		return s;
	}

	static List<String> bounds(Type t) {
		List<String> out = new ArrayList<>();
		if (t instanceof Class<?> c) out.add(c.getName());
		else if (t instanceof ParameterizedType pt) out.add(((Class<?>) pt.getRawType()).getName());
		else if (t instanceof TypeVariable<?> tv) for (Type b : tv.getBounds()) out.addAll(bounds(b));
		return out;
	}

	static Class<?> raw(Type t) {
		if (t instanceof Class<?> c) return c;
		if (t instanceof ParameterizedType pt) return (Class<?>) pt.getRawType();
		if (t instanceof TypeVariable<?> tv) return raw(tv.getBounds()[0]);
		if (t instanceof WildcardType w) return raw(w.getUpperBounds()[0]);
		if (t instanceof java.lang.reflect.GenericArrayType ga) return raw(ga.getGenericComponentType()).arrayType();
		return Object.class;
	}

	/** What kind of value a parameter takes, as the editor and generator understand it, or `other:<type>`. */
	static String paramType(Type t, boolean varargs) {
		Class<?> r = raw(t);
		if (r == double.class || r == float.class || r == int.class || r == boolean.class) return r.getName();
		if (r == net.minecraft.world.entity.ai.targeting.TargetingConditions.Selector.class) return "selector";
		if (isMobType(r)) return "mob";
		if (r.isArray() && r.getComponentType() == Class.class && varargs) return "entityClasses";
		if (r == Class.class) return "entityClass";
		if (r == net.minecraft.world.level.Level.class) return "level";
		if (r == net.minecraft.world.level.block.Block.class) return "block";
		if (r == net.minecraft.world.item.ItemStack.class) return "itemStack";
		if (r == SoundEvent.class) return "sound";
		if (r == net.minecraft.world.entity.ai.targeting.TargetingConditions.Selector.class) return "selector";
		if (r == java.util.function.Predicate.class && t instanceof ParameterizedType pt && raw(pt.getActualTypeArguments()[0]) == net.minecraft.world.item.ItemStack.class) return "itemTest";
		if (r == net.minecraft.tags.TagKey.class && t instanceof ParameterizedType pt) {
			Class<?> of = raw(pt.getActualTypeArguments()[0]);
			if (of == net.minecraft.world.level.material.Fluid.class) return "fluidTag";
			if (of == net.minecraft.world.damagesource.DamageType.class) return "damageTag";
		}
		return "other:" + t.getTypeName();
	}

	/** The mob a goal drives: a Mob, or one of the mob interfaces like RangedAttackMob. */
	static boolean isMobType(Class<?> r) {
		return net.minecraft.world.entity.Mob.class.isAssignableFrom(r) || (r.isInterface() && r.getPackageName().startsWith("net.minecraft.world.entity") && !r.getSimpleName().contains("Goal"));
	}

	/**
	 * Parameter names, which the jar doesn't keep: each is named after the field the constructor stores it in, or
	 * the parameter it is passed on to in this(...) or super(...). Falls back to arg0, arg1...
	 */
	static final Map<String, List<String>> NAME_CACHE = new HashMap<>();

	static List<String> paramNames(Class<?> owner, Executable e) {
		String desc = e instanceof Constructor<?> k ? MethodTypeDesc.of(ClassDesc.ofDescriptor("V"), Arrays.stream(k.getParameterTypes()).map(c -> c.describeConstable().orElseThrow()).toArray(ClassDesc[]::new)).descriptorString()
				: MethodTypeDesc.of(((Method) e).getReturnType().describeConstable().orElseThrow(), Arrays.stream(e.getParameterTypes()).map(c -> c.describeConstable().orElseThrow()).toArray(ClassDesc[]::new)).descriptorString();
		String method = e instanceof Constructor<?> ? "<init>" : e.getName();
		return paramNames(owner.getName().replace('.', '/'), method, desc, e.getParameterCount());
	}

	static List<String> paramNames(String owner, String method, String desc, int count) {
		String key = owner + "." + method + desc;
		if (NAME_CACHE.containsKey(key)) return NAME_CACHE.get(key);
		String[] names = new String[count];
		ClassModel cm = parse(owner);
		MethodTypeDesc mtd = MethodTypeDesc.ofDescriptor(desc);
		if (cm != null) {
			for (MethodModel m : cm.methods()) {
				if (!m.methodName().equalsString(method) || !m.methodType().equalsString(desc) || m.code().isEmpty()) continue;
				boolean isStatic = (m.flags().flagsMask() & ClassFile.ACC_STATIC) != 0;
				// slot -> parameter index
				Map<Integer, Integer> slots = new HashMap<>();
				int slot = isStatic ? 0 : 1;
				for (int i = 0; i < count; i++) {
					slots.put(slot, i);
					slot += TypeKind.from(mtd.parameterType(i)).slotSize();
				}
				simulate(m.code().get(), slots, names, cm);
			}
		}
		List<String> out = new ArrayList<>();
		for (int i = 0; i < count; i++) out.add(names[i] != null ? names[i] : "arg" + i);
		NAME_CACHE.put(key, out);
		return out;
	}

	/** A tiny stack machine over straight-line code: enough to see which parameter reaches which field or call. */
	static void simulate(CodeModel code, Map<Integer, Integer> slots, String[] names, ClassModel cm) {
		Deque<Object> stack = new ArrayDeque<>();
		Object none = new Object();
		for (CodeElement el : code) {
			if (!(el instanceof Instruction ins)) continue;
			try {
				if (ins instanceof LoadInstruction l) {
					stack.push(slots.containsKey(l.slot()) ? (Object) slots.get(l.slot()) : (l.slot() == 0 ? "this" : none));
				} else if (ins instanceof FieldInstruction f) {
					switch (f.opcode()) {
						case PUTFIELD -> {
							Object v = stack.pop();
							stack.pop();
							if (v instanceof Integer i && names[i] == null) names[i] = f.name().stringValue();
						}
						case GETFIELD -> { stack.pop(); stack.push(none); }
						case GETSTATIC -> stack.push(none);
						case PUTSTATIC -> stack.pop();
						default -> {}
					}
				} else if (ins instanceof InvokeInstruction inv) {
					MethodTypeDesc t = inv.typeSymbol();
					Object[] args = new Object[t.parameterCount()];
					for (int i = args.length - 1; i >= 0; i--) args[i] = stack.pop();
					Object receiver = inv.opcode() == Opcode.INVOKESTATIC ? null : stack.pop();
					boolean delegate = inv.name().equalsString("<init>") && "this".equals(receiver);
					if (delegate || (receiver == null && false)) {
						List<String> inner = paramNames(inv.owner().asInternalName(), "<init>", t.descriptorString(), args.length);
						for (int i = 0; i < args.length; i++) {
							if (args[i] instanceof Integer p && names[p] == null && !inner.get(i).startsWith("arg")) names[p] = inner.get(i);
						}
					}
					if (!t.returnType().descriptorString().equals("V")) stack.push(none);
				} else if (ins instanceof InvokeDynamicInstruction indy) {
					for (int i = 0; i < indy.typeSymbol().parameterCount(); i++) stack.pop();
					stack.push(none);
				} else if (ins instanceof NewObjectInstruction) {
					stack.push(none);
				} else if (ins instanceof ConstantInstruction) {
					stack.push(none);
				} else {
					switch (ins.opcode()) {
						case DUP -> stack.push(stack.peek());
						case CHECKCAST, I2F, I2D, F2D, D2F, F2I, D2I, I2L, L2I -> {}
						case POP -> stack.pop();
						case DADD, DSUB, DMUL, DDIV, FADD, FSUB, FMUL, FDIV, IADD, ISUB, IMUL, IDIV, DCMPL, DCMPG, FCMPL, FCMPG -> { stack.pop(); stack.pop(); stack.push(none); }
						case IFEQ, IFNE, IFLT, IFGE, IFGT, IFLE, IFNULL, IFNONNULL -> stack.pop();
						case IF_ICMPEQ, IF_ICMPNE, IF_ICMPLT, IF_ICMPGE, IF_ICMPGT, IF_ICMPLE, IF_ACMPEQ, IF_ACMPNE -> { stack.pop(); stack.pop(); }
						case ANEWARRAY, NEWARRAY -> { stack.pop(); stack.push(none); }
						case AASTORE -> { stack.pop(); stack.pop(); stack.pop(); }
						case ARRAYLENGTH, INSTANCEOF -> { stack.pop(); stack.push(none); }
						case ATHROW -> stack.pop();
						case RETURN, GOTO, GOTO_W, ARETURN, IRETURN, DRETURN, FRETURN -> {}
						case ASTORE, ISTORE, DSTORE, FSTORE -> stack.pop();
						default -> { return; }
					}
				}
			} catch (NoSuchElementException ex) {
				return;
			}
		}
	}

	static JsonArray supertypes(Class<?> c) {
		Set<String> out = new TreeSet<>();
		Deque<Class<?>> todo = new ArrayDeque<>(List.of(c));
		while (!todo.isEmpty()) {
			Class<?> k = todo.pop();
			if (!out.add(k.getName())) continue;
			if (k.getSuperclass() != null) todo.push(k.getSuperclass());
			todo.addAll(List.of(k.getInterfaces()));
		}
		return strings(out);
	}

	// ---------------------------------------------------------------- entities

	/** Living entity types and their classes, for goals that target, avoid or ignore a kind of mob. */
	static JsonObject entities() throws Exception {
		JsonObject out = new JsonObject();
		Map<String, String> sorted = new TreeMap<>();
		Class<?> holder = Class.forName("net.minecraft.world.entity.EntityTypes");
		for (Field f : holder.getFields()) {
			if (f.getType() != EntityType.class || !(f.getGenericType() instanceof ParameterizedType pt)) continue;
			Class<?> c = raw(pt.getActualTypeArguments()[0]);
			if (!LivingEntity.class.isAssignableFrom(c) || !Modifier.isPublic(c.getModifiers())) continue;
			// The class, then its superclasses down to Entity, so goals can check what a Class<...> accepts.
			List<String> chain = new ArrayList<>();
			for (Class<?> k = c; k != null && net.minecraft.world.entity.Entity.class.isAssignableFrom(k); k = k.getSuperclass()) chain.add(k.getName());
			sorted.put(entityId("net/minecraft/world/entity/EntityTypes", f.getName()), String.join(" ", chain));
		}
		sorted.forEach((id, chain) -> out.add(id, strings(List.of(chain.split(" ")))));
		return out;
	}
}
