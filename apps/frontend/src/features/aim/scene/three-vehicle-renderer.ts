import {
  ACESFilmicToneMapping,
  AmbientLight,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  GridHelper,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import type {
  AimMaterialMode,
  AimSceneModel,
  AimScenePart,
  AimVehicleRenderer,
  ProxyAnchor,
} from './scene-types';

const purple = 0x9578ff;
const silver = 0xb9bec8;
const graphite = 0x303640;
const additiveDurationMs = 2_600;

interface PartNode {
  readonly root: Group;
  readonly surfaces: Array<Mesh<BufferGeometry, Material | Material[]>>;
  readonly outlines: LineSegments[];
  readonly scanner: Mesh;
  readonly geometries: readonly BufferGeometry[];
  readonly materials: Set<Material>;
  readonly minimumY: number;
  readonly maximumY: number;
  readonly clippingPlane: Plane;
  material: AimMaterialMode;
  targetRevealProgress: number;
  animationStartedAt: number | null;
}

function createGeometry(anchor: ProxyAnchor): BufferGeometry {
  switch (anchor.shape) {
    case 'box':
      return new BoxGeometry(1, 1, 1);
    case 'cone':
      return new ConeGeometry(0.5, 1, 28, 1, true);
    case 'cylinder':
      return new CylinderGeometry(0.5, 0.5, 1, 32, 1, true);
    case 'engine_cluster':
      return new ConeGeometry(0.16, 0.55, 18, 1, true);
  }
}

function makeSurfaceMaterial(mode: AimMaterialMode, clippingPlane: Plane): Material {
  switch (mode) {
    case 'wireframe':
      return new MeshBasicMaterial({
        color: purple,
        opacity: 0.5,
        transparent: true,
        wireframe: true,
      });
    case 'additive_reveal':
      return new MeshStandardMaterial({
        clippingPlanes: [clippingPlane],
        color: purple,
        emissive: new Color(purple),
        emissiveIntensity: 0.24,
        metalness: 0.36,
        opacity: 0.78,
        roughness: 0.42,
        transparent: true,
      });
    case 'partial_scaffold':
      return new MeshStandardMaterial({
        color: silver,
        emissive: new Color(purple),
        emissiveIntensity: 0.08,
        metalness: 0.68,
        opacity: 0.64,
        roughness: 0.36,
        transparent: true,
      });
    case 'solid':
      return new MeshStandardMaterial({
        color: silver,
        emissive: new Color(purple),
        emissiveIntensity: 0.055,
        metalness: 0.84,
        roughness: 0.3,
      });
    case 'ghost':
      return new MeshBasicMaterial({
        color: graphite,
        depthWrite: false,
        opacity: 0.2,
        transparent: true,
        wireframe: true,
      });
  }
}

function setPartId(object: Object3D, partId: string) {
  object.name = `aim-part:${partId}`;
}

function createPartNode(part: AimScenePart): PartNode | null {
  if (part.anchor.kind === 'fallback') return null;

  const { anchor } = part.anchor;
  const root = new Group();
  root.position.set(...anchor.position);
  setPartId(root, part.id);

  const minimumY = anchor.position[1] - anchor.scale[1] / 2;
  const maximumY = anchor.position[1] + anchor.scale[1] / 2;
  const clippingPlane = new Plane(
    new Vector3(0, -1, 0),
    part.material === 'additive_reveal' ? minimumY : maximumY,
  );
  const geometry = createGeometry(anchor);
  const surfaceMaterial = makeSurfaceMaterial(part.material, clippingPlane);
  const surfaces: Array<Mesh<BufferGeometry, Material | Material[]>> = [];

  if (anchor.shape === 'engine_cluster') {
    const engines = new InstancedMesh(geometry, surfaceMaterial, 13);
    const transform = new Matrix4();
    for (let index = 0; index < 13; index += 1) {
      const angle = ((index - 1) / 12) * Math.PI * 2;
      const radius = index === 0 ? 0 : 0.48;
      transform.makeTranslation(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      engines.setMatrixAt(index, transform);
    }
    engines.instanceMatrix.needsUpdate = true;
    engines.scale.set(...anchor.scale);
    setPartId(engines, part.id);
    surfaces.push(engines);
    root.add(engines);
  } else {
    const surface = new Mesh(geometry, surfaceMaterial);
    surface.scale.set(...anchor.scale);
    setPartId(surface, part.id);
    surfaces.push(surface);
    root.add(surface);
  }

  const outlineGeometry = new EdgesGeometry(geometry, 20);
  const outlineMaterial = new LineBasicMaterial({
    color: purple,
    opacity: 0.68,
    transparent: true,
  });
  const outline = new LineSegments(outlineGeometry, outlineMaterial);
  outline.scale.set(...anchor.scale);
  outline.visible = part.material === 'partial_scaffold' || part.material === 'wireframe';
  setPartId(outline, part.id);
  root.add(outline);

  const scannerGeometry = new PlaneGeometry(
    Math.max(anchor.scale[0], 0.3) * 1.2,
    Math.max(anchor.scale[2], 0.3) * 1.2,
  );
  const scannerMaterial = new MeshBasicMaterial({
    color: purple,
    opacity: 0.5,
    side: DoubleSide,
    transparent: true,
  });
  const scanner = new Mesh(scannerGeometry, scannerMaterial);
  scanner.rotation.x = Math.PI / 2;
  scanner.position.y = -anchor.scale[1] / 2;
  scanner.visible = part.material === 'additive_reveal';
  setPartId(scanner, part.id);
  root.add(scanner);

  return {
    root,
    surfaces,
    outlines: [outline],
    scanner,
    geometries: [geometry, outlineGeometry, scannerGeometry],
    materials: new Set([surfaceMaterial, outlineMaterial, scannerMaterial]),
    minimumY,
    maximumY,
    clippingPlane,
    material: part.material,
    targetRevealProgress: part.additiveRevealProgress,
    animationStartedAt: part.material === 'additive_reveal' ? performance.now() : null,
  };
}

function disposePartNode(node: PartNode) {
  node.geometries.forEach((geometry) => geometry.dispose());
  node.materials.forEach((material) => material.dispose());
  node.materials.clear();
}

class ThreeAimVehicleRenderer implements AimVehicleRenderer {
  readonly mode = 'webgl' as const;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-5, 5, 5.5, -5.5, 0.1, 100);
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly partNodes = new Map<string, PartNode>();
  private readonly vehicleRoot = new Group();
  private frameId: number | null = null;
  private structureKey = '';
  private reducedMotion = false;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    model: AimSceneModel,
    options: { reducedMotion: boolean },
  ) {
    this.renderer = new WebGLRenderer({
      alpha: true,
      antialias: true,
      canvas,
      powerPreference: 'high-performance',
    });
    this.renderer.localClippingEnabled = true;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.setClearColor(0x05070a, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));

    this.camera.position.set(7.8, 0.45, 13.5);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(this.vehicleRoot);
    this.scene.add(new AmbientLight(0xcfd4df, 1.6));
    const keyLight = new DirectionalLight(0xffffff, 2.5);
    keyLight.position.set(4, 8, 7);
    this.scene.add(keyLight);
    const purpleLight = new DirectionalLight(purple, 1.2);
    purpleLight.position.set(-5, 1, 5);
    this.scene.add(purpleLight);
    const grid = new GridHelper(10, 20, 0x4b426d, 0x1b1f27);
    grid.position.y = -4.65;
    this.scene.add(grid);

    this.setModel(model, options);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  setModel(model: AimSceneModel, options: { reducedMotion: boolean }) {
    if (this.disposed) return;
    this.reducedMotion = options.reducedMotion;
    const nextStructureKey = model.parts
      .map((part) =>
        part.anchor.kind === 'mapped'
          ? `${part.id}:${part.anchor.anchor.id}`
          : `${part.id}:fallback`,
      )
      .join('|');

    if (this.structureKey !== nextStructureKey) {
      this.rebuild(model);
      this.structureKey = nextStructureKey;
    } else {
      model.parts.forEach((part) => this.updatePart(part));
    }
    this.restartAnimationsIfNeeded();
    this.render();
  }

  resize(width: number, height: number) {
    if (this.disposed || width <= 0 || height <= 0) return;
    const aspect = width / height;
    const viewHeight = 10.8;
    this.camera.left = (-viewHeight * aspect) / 2;
    this.camera.right = (viewHeight * aspect) / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.render();
  }

  pick(clientX: number, clientY: number): string | null {
    if (this.disposed) return null;
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    this.pointer.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersection = this.raycaster.intersectObjects(
      [...this.partNodes.values()].map(({ root }) => root),
      true,
    )[0];
    let target: Object3D | null = intersection?.object ?? null;
    while (target) {
      if (target.name.startsWith('aim-part:')) return target.name.slice('aim-part:'.length);
      target = target.parent;
    }
    return null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.partNodes.forEach((node) => disposePartNode(node));
    this.partNodes.clear();
    this.renderer.dispose();
  }

  private readonly handleVisibilityChange = () => {
    if (document.hidden) {
      if (this.frameId !== null) cancelAnimationFrame(this.frameId);
      this.frameId = null;
      return;
    }
    this.restartAnimationsIfNeeded();
    this.render();
  };

  private rebuild(model: AimSceneModel) {
    this.partNodes.forEach((node) => {
      this.vehicleRoot.remove(node.root);
      disposePartNode(node);
    });
    this.partNodes.clear();
    model.parts.forEach((part) => {
      const node = createPartNode(part);
      if (!node) return;
      this.partNodes.set(part.id, node);
      this.vehicleRoot.add(node.root);
      this.updatePart(part);
    });
  }

  private updatePart(part: AimScenePart) {
    const node = this.partNodes.get(part.id);
    if (!node) return;
    if (node.material !== part.material) {
      const previousMaterials = new Set<Material>();
      node.surfaces.forEach((surface) => {
        const previous = surface.material;
        const next = makeSurfaceMaterial(part.material, node.clippingPlane);
        surface.material = next;
        node.materials.add(next);
        if (Array.isArray(previous)) {
          previous.forEach((material) => previousMaterials.add(material));
        } else {
          previousMaterials.add(previous);
        }
      });
      previousMaterials.forEach((material) => {
        node.materials.delete(material);
        material.dispose();
      });
      node.material = part.material;
      node.animationStartedAt = null;
    }
    node.outlines.forEach((outline) => {
      outline.visible = part.material === 'wireframe' || part.material === 'partial_scaffold';
    });
    node.scanner.visible = part.material === 'additive_reveal' && !this.reducedMotion;
    node.targetRevealProgress = part.additiveRevealProgress;
    if (part.material === 'additive_reveal') {
      if (this.reducedMotion) {
        const finalHeight =
          node.minimumY + (node.maximumY - node.minimumY) * node.targetRevealProgress;
        node.clippingPlane.constant = finalHeight;
        node.scanner.position.y = finalHeight - node.root.position.y;
      } else if (node.animationStartedAt === null) {
        node.animationStartedAt = performance.now();
        node.clippingPlane.constant = node.minimumY;
      }
    }
  }

  private restartAnimationsIfNeeded() {
    if (this.reducedMotion || document.hidden || this.frameId !== null) return;
    const hasActiveAnimation = [...this.partNodes.values()].some(
      (node) => node.material === 'additive_reveal' && node.animationStartedAt !== null,
    );
    if (hasActiveAnimation) this.frameId = requestAnimationFrame(this.animate);
  }

  private readonly animate = (timestamp: number) => {
    this.frameId = null;
    if (this.disposed || document.hidden || this.reducedMotion) return;
    let keepAnimating = false;
    this.partNodes.forEach((node) => {
      if (node.material !== 'additive_reveal' || node.animationStartedAt === null) return;
      const progress = Math.min(1, (timestamp - node.animationStartedAt) / additiveDurationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      const height =
        node.minimumY + (node.maximumY - node.minimumY) * eased * node.targetRevealProgress;
      node.clippingPlane.constant = height;
      node.scanner.position.y = height - node.root.position.y;
      node.scanner.visible = progress < 1;
      if (progress < 1) keepAnimating = true;
      else node.animationStartedAt = null;
    });
    this.render();
    if (keepAnimating) this.frameId = requestAnimationFrame(this.animate);
  };

  private render() {
    if (!this.disposed) this.renderer.render(this.scene, this.camera);
  }
}

export function createThreeAimVehicleRenderer(
  canvas: HTMLCanvasElement,
  model: AimSceneModel,
  options: { reducedMotion: boolean },
): AimVehicleRenderer {
  return new ThreeAimVehicleRenderer(canvas, model, options);
}
