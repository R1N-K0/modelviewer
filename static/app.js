import {
  Box3, Color, DirectionalLight, HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  NearestFilter, PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial, Sphere, Vector2,
  Vector3, WebGLRenderer, WebGLRenderTarget,
} from 'three';
import { TrackballControls } from './vendor/three/addons/controls/TrackballControls.js';
import { GLTFLoader } from './vendor/three/addons/loaders/GLTFLoader.js';

const MODELS = ['dragon', 'bunny', 'teapot'];
// The share of the remaining turn that is applied in one 60 Hz frame of the glide after the
// finger lifts. At 0.05 the glide went on for about a second, which overshot the view that was
// aimed at; at 0.2 it is down to 3.5% in about 0.25 s.
const DAMPING_PER_60HZ_FRAME = 0.2;
// TrackballControls turns by rotateSpeed radians for a drag of half the canvas's width, up and
// down as well as sideways (it measures both by the width). At pi a drag across the whole width
// is one full turn. Turning the model upside down, half a turn, then takes an upward drag of half
// the width: 960 pixels on a PC screen 1920 wide, most of the canvas's height, so anything slower
// would need two strokes there.
const ROTATE_SPEED = Math.PI;
// A wheel notch changes the distance by a factor of 0.95, as it did before the trackball.
const WHEEL_NOTCH_SCALE = 0.95;
// The loop stops once a frame turns the view by less than this many radians per 60 Hz frame, or
// moves the camera by less than this share of its distance. TrackballControls never ends a glide
// itself: it shrinks the step on every update() without reaching 0. The rest it would still have
// turned, four times the last step at 60 Hz, then moves a point 1000 pixels from the centre of
// the screen by 0.4 pixels.
const STILL_PER_60HZ_FRAME = 1e-4;
const DOUBLE_TAP_MS = 300;
const TAP_SLOP_PX = 10;
// Seen from the front and a little above, the usual way to look at an object on a table.
const HOME_DIRECTION = [0, 0.3, 1];
const HOME_ELEVATION = Math.atan2(HOME_DIRECTION[1], Math.hypot(HOME_DIRECTION[0], HOME_DIRECTION[2]));
const MARGIN = 1.05;
// The mask look copies maskeditor's render.py, so a mask drawn there can be compared by eye
// with what one from this viewpoint would be. The colours are not part of the page's theme:
// they are the pixel classes of the dataset (data/objects.json in maskeditor), one class per
// shape: dragon is gray_dragon, teapot blue_pot, bunny yellow_bunny.
const MASK_COLORS = {
  dragon: [230, 25, 75],
  teapot: [255, 225, 25],
  bunny: [245, 130, 48],
};
// The long side, in photo pixels, of each shape's mask at its usual size in the dataset's
// 1920x1440 photos: the median long side of the bounding box of the object's mask over 150
// sampled ok masks (2026-10-19), one round number for the classes of each shape (dragon 256 and
// 242, teapot 155 and 156, bunny 196, 198 and 212).
const MASK_PHOTO_SIZE = {
  dragon: 250,
  teapot: 155,
  bunny: 200,
};
// The outline's width in photo pixels. maskeditor's is 1; the user asked for a thicker one here
// (2026-10-19). 1 gives maskeditor's look again.
const MASK_EDGE_PHOTO_PX = 2;
// render.py's ALPHA: the share of the class colour inside the mask.
const MASK_ALPHA = 0.18;
// The widest outline the shader looks for, in drawing-buffer pixels. The teapot at the closest
// zoom gives the widest, 0.034 of the drawing buffer's height at 2 photo pixels, so this holds
// up to 3700 pixels high, past a 5K screen at devicePixelRatio 2; it only bounds the loop.
const MASK_MAX_EDGE = 128;

const canvas = document.getElementById('view');
const buttons = [...document.querySelectorAll('#models button')];
const themeButton = document.getElementById('theme');
const maskButton = document.getElementById('mask');

const renderer = new WebGLRenderer({ canvas, antialias: true });

const scene = new Scene();
scene.background = new Color();
// Low enough that the brightest face stays darker than the light background, so the outline
// shows; on the dark one it is lighter instead.
scene.add(new HemisphereLight(0xffffff, 0x8a8a8a, 1.2));

const camera = new PerspectiveCamera(40, 1, 0.01, 100);
// A drag moves the camera round the object, not the object. A light fixed in the world would
// leave the side turned to the viewer dark from half the angles, so it goes round with the camera.
const sun = new DirectionalLight(0xffffff, 1.5);
sun.position.set(1, 1.5, 0.5);
camera.add(sun);
scene.add(camera);

// As dark as the objects in the dataset's photos, so the mask's 18% of class colour shows as much
// as it does over a photo in maskeditor; over a light gray it hardly showed. The mean of R, G, B
// inside the mask over 150 sampled ok masks (2026-10-19) has a median of 107 over the 530 objects
// (mean 120; gray_dragon 110, green_dragon 91, blue_pot 103, white_pot 196, yellow_bunny 130,
// red_bunny 87, blue_bunny 98). This colour draws the model with the same mean over its pixels,
// measured on screen at the home view with the lights above (dragon 106, bunny 111, teapot 106);
// the colour's own value is higher, as the lights scale it. Measure again if the lights change.
const material = new MeshStandardMaterial({ color: 0x8b8b8b, roughness: 0.8 });

// A trackball, so that any view can be had: controls that turn only sideways and up and down
// stop at straight above and below, and a view with the dragon's head down cannot be had.
// TrackballControls turns about the axis on screen square to the drag, so dragging on upward goes
// over the top to upside down, and a circling drag tilts the model in the screen.
const controls = new TrackballControls(camera, canvas);
controls.rotateSpeed = ROTATE_SPEED;
controls.noPan = true;
// TrackballControls listens on window for A, S and D held during a drag, to make it turn, zoom or
// pan. The page has no keys to learn, and S pressed for anything else would turn a drag into a
// zoom, so none is set. An empty list rather than empty names, as a key the browser cannot name
// has '' as its code.
controls.keys = [];

// The silhouette is drawn alone into a texture, then a pass over the whole screen lays the mask
// on the picture. The texture has no antialiasing, so each pixel is in or out like a mask's.
const maskTarget = new WebGLRenderTarget(1, 1, {
  minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false,
});
// The same side as the shaded material, so the mask covers exactly the pixels the model is drawn
// on: a gap that shows the background through the dragon stays a hole, as it would in a photo.
const silhouette = new MeshBasicMaterial({ color: 0xffffff, side: material.side });
// Plain alpha blending over the finished picture is render.py's over(): picture * (1 - a) +
// colour * a, with a = 1 on the outline. Both work on the sRGB values as stored, so the colour is
// given as those values and the shader leaves out three.js's colour space conversion.
const overlayMaterial = new ShaderMaterial({
  uniforms: {
    mask: { value: maskTarget.texture },
    size: { value: new Vector2(1, 1) },
    edgeWidth: { value: 1 },
    color: { value: new Vector3() },
    alpha: { value: MASK_ALPHA },
  },
  vertexShader: `
    void main() {
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  // render.py's find_edges(): a mask pixel with a 4-neighbour outside is outline, so the line
  // lies just inside the boundary. Here the outline's photo pixels span edgeWidth screen
  // pixels, so the neighbours are looked for along the row and the column up to that distance,
  // as find_edges looks only along rows and columns. The border of the picture is not an edge
  // there either, which reading past it here gives too, as the texture is clamped to its last
  // row and column.
  defines: { MAX_EDGE: MASK_MAX_EDGE },
  fragmentShader: `
    uniform sampler2D mask;
    uniform vec2 size;
    uniform float edgeWidth;
    uniform vec3 color;
    uniform float alpha;
    float inside(vec2 offset) {
      return texture2D(mask, (gl_FragCoord.xy + offset) / size).r;
    }
    void main() {
      if (inside(vec2(0.0)) < 0.5) discard;
      for (int k = 1; k <= MAX_EDGE; k++) {
        float d = float(k);
        if (d > edgeWidth) break;
        float around = min(min(inside(vec2(d, 0.0)), inside(vec2(-d, 0.0))),
                           min(inside(vec2(0.0, d)), inside(vec2(0.0, -d))));
        if (around < 0.5) {
          gl_FragColor = vec4(color, 1.0);
          return;
        }
      }
      gl_FragColor = vec4(color, alpha);
    }
  `,
  transparent: true,
  depthTest: false,
  depthWrite: false,
});
const overlayQuad = new Mesh(new PlaneGeometry(2, 2), overlayMaterial);
overlayQuad.frustumCulled = false;
const overlay = new Scene();
overlay.add(overlayQuad);
let masked = false;
let maskPrepared = false;

const loader = new GLTFLoader();
const loaded = new Map();
let shown = null;
let shownName = null;
let current = null;
let sphere = new Sphere();
let cylinder = { radius: 0, half: 0 };
let longSide = 0;
let fitted = 0;

// Fitted to the upright cylinder round the model rather than its bounding sphere: the model
// stands upright in the home view, and on a tall phone screen the sphere is wider than anything
// that view shows. Seen from above at an elevation, the cylinder's top rim adds to its height on
// screen. Turned away from home, the model may reach past the edge: the trackball turns any way,
// and even a sideways drag turns about the screen's vertical, not Y. Zooming out brings it back.
function fitDistance() {
  const vertical = camera.fov * Math.PI / 180;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
  const height = cylinder.half * Math.cos(HOME_ELEVATION) + cylinder.radius * Math.sin(HOME_ELEVATION);
  return MARGIN * Math.max(
    cylinder.radius / Math.sin(horizontal / 2),
    height / Math.sin(vertical / 2),
  );
}

// Keeps whatever zoom the user chose, relative to the fit, when the window changes shape.
function refit(home) {
  const distance = fitDistance();
  const offset = camera.position.clone().sub(controls.target);
  if (home || fitted === 0 || offset.lengthSq() === 0) {
    offset.set(...HOME_DIRECTION).setLength(distance);
    // TrackballControls turns camera.up with the view, so home would stay tilted without this.
    camera.up.set(0, 1, 0);
  } else {
    offset.multiplyScalar(distance / fitted);
  }
  fitted = distance;
  controls.target.copy(sphere.center);
  camera.position.copy(sphere.center).add(offset);
  controls.minDistance = sphere.radius;
  controls.maxDistance = distance * 3;
  camera.near = sphere.radius * 0.01;
  camera.far = distance * 3 + sphere.radius * 2;
  camera.updateProjectionMatrix();
  controls.update();
  wake();
}

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) return;
  // TrackballControls measures drags against the canvas's rectangle, which it reads only here.
  controls.handleResize();
  // devicePixelRatio changes when the window moves to another monitor or the page is zoomed.
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(width, height, false);
  const size = renderer.getDrawingBufferSize(overlayMaterial.uniforms.size.value);
  maskTarget.setSize(size.x, size.y);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  if (shown) refit(false);
}

function prepare(gltf) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const bounds = new Sphere();
  let first = true;
  root.traverse((child) => {
    if (!child.isMesh) return;
    if (!child.geometry.attributes.normal) child.geometry.computeVertexNormals();
    child.material = material;
    child.geometry.computeBoundingSphere();
    const part = child.geometry.boundingSphere.clone().applyMatrix4(child.matrixWorld);
    if (first) bounds.copy(part); else bounds.union(part);
    first = false;
  });
  const cylinder = { radius: 0, half: 0 };
  const box = new Box3();
  const point = new Vector3();
  root.traverse((child) => {
    if (!child.isMesh) return;
    const position = child.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld);
      box.expandByPoint(point);
      point.sub(bounds.center);
      cylinder.radius = Math.max(cylinder.radius, Math.hypot(point.x, point.z));
      cylinder.half = Math.max(cylinder.half, Math.abs(point.y));
    }
  });
  const extent = box.getSize(new Vector3());
  return { root, bounds, cylinder, longSide: Math.max(extent.x, extent.y, extent.z) };
}

function load(name) {
  if (!loaded.has(name)) {
    const promise = loader.loadAsync(`models/${name}.glb`).then(prepare);
    promise.catch(() => loaded.delete(name));
    loaded.set(name, promise);
  }
  return loaded.get(name);
}

function mark(name) {
  history.replaceState(null, '', name ? `#${name}` : location.pathname);
  for (const button of buttons) {
    button.classList.toggle('selected', button.dataset.model === name);
  }
}

async function select(name) {
  if (!MODELS.includes(name)) name = MODELS[0];
  if (name === current) return;
  current = name;
  mark(name);
  const button = buttons.find((b) => b.dataset.model === name);
  button.classList.add('loading');
  let model;
  try {
    model = await load(name);
  } catch {
    // Back to what is on screen, so pressing the same button again tries again.
    if (name === current) {
      current = shownName;
      mark(shownName);
    }
    return;
  } finally {
    button.classList.remove('loading');
  }
  if (name !== current) return;
  if (shown) scene.remove(shown);
  shown = model.root;
  shownName = name;
  scene.add(shown);
  sphere = model.bounds;
  cylinder = model.cylinder;
  longSide = model.longSide;
  refit(true);
  // The first press of the mask button would otherwise wait for the mask's shaders and texture
  // to be built, most of a frame; done once here, off screen, while the first model appears.
  if (!maskPrepared) {
    drawSilhouette();
    renderer.compile(overlay, camera);
    maskPrepared = true;
  }
}

let running = false;
let gliding = false;
let dirty = true;
let last = null;
const lastPosition = new Vector3();
const lastUp = new Vector3();
// TrackballControls fires 'end' for each finger lifted, so already after the first of two, and
// nothing on pointercancel; and a drag moves the view only in update(), which the loop calls, so
// a loop stopped while a finger rests would leave the drag dead. The loop keeps running while
// any pointer counted here is down on the canvas.
const pressed = new Set();

// maskeditor's outline is one photo pixel, scaled with the photo when zoomed; here it is
// MASK_EDGE_PHOTO_PX of them. How large a photo pixel is on the object depends on how far the
// camera was, not on how the object was turned, so the width here follows only the camera's
// distance: the model's long side in pixels, as if it stood square to the camera at the target,
// over its long side in the photos.
function edgeWidth() {
  const height = overlayMaterial.uniforms.size.value.y;
  const distance = camera.position.distanceTo(sphere.center);
  const pixelsPerUnit = height / (2 * Math.tan(camera.fov * Math.PI / 360) * distance);
  const photoPixel = longSide * pixelsPerUnit / MASK_PHOTO_SIZE[shownName];
  // Rounded after the photo pixels are added up, so 2 photo pixels of 1.4 screen pixels each
  // are 3, not 2 * 1; whole pixels, as maskeditor's edge is.
  const width = Math.round(MASK_EDGE_PHOTO_PX * photoPixel);
  return Math.min(Math.max(width, 1), MASK_MAX_EDGE);
}

function drawSilhouette() {
  const background = scene.background;
  scene.background = null;
  scene.overrideMaterial = silhouette;
  renderer.setRenderTarget(maskTarget);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  scene.overrideMaterial = null;
  scene.background = background;
}

function drawMask() {
  drawSilhouette();
  overlayMaterial.uniforms.color.value.fromArray(MASK_COLORS[shownName]).divideScalar(255);
  overlayMaterial.uniforms.edgeWidth.value = edgeWidth();
  renderer.autoClear = false;
  renderer.render(overlay, camera);
  renderer.autoClear = true;
}

function draw() {
  renderer.render(scene, camera);
  if (masked && shown) drawMask();
}

function frame(now) {
  // The first frame after a wake has no frame before it; counted as none, it would damp by
  // nothing, nothing would move, and the loop would stop with the glide still owed.
  const seconds = last === null ? 1 / 60 : Math.min(Math.max(now - last, 0) / 1000, 0.1);
  last = now;
  const frames = seconds * 60;
  // Once the pointer stops, TrackballControls keeps turning by the last step's angle and
  // multiplies it by sqrt(1 - dynamicDampingFactor) on every update(), so a fixed factor would
  // stop a 120 Hz phone in half the time of a 60 Hz screen. For the step to fall by
  // (1 - DAMPING_PER_60HZ_FRAME) per 60 Hz frame however often frames come,
  // sqrt(1 - factor) = (1 - DAMPING_PER_60HZ_FRAME)^frames, so the square root is undone by the
  // 2 here; at 60 Hz the factor is 0.36. The zoom still owed falls by (1 - factor) itself, so
  // its glide ends twice as fast as the turn's, which suits a zoom that used to have none.
  const damping = 1 - Math.pow(1 - DAMPING_PER_60HZ_FRAME, 2 * frames);
  controls.dynamicDampingFactor = damping;
  // A wheel event adds deltaY * 0.00025 to the zoom TrackballControls owes, and each update()
  // zooms by zoomSpeed times what is owed while that falls by (1 - damping). A notch (deltaY
  // 100) thus changes the log of the distance by about 0.025 * zoomSpeed / damping, so a fixed
  // zoomSpeed would zoom further at a higher frame rate; scaled with the damping it does not.
  controls.zoomSpeed = -Math.log(WHEEL_NOTCH_SCALE) / (100 * 0.00025) * damping;
  // update() runs only while the controls are in use; otherwise a wake that only redraws (the
  // mask or background button) would move the model by the rest of a glide, which goes into the
  // next drag or zoom instead. update() returns nothing, and fires 'change' only once the camera
  // is 0.001 from where it last fired, which a roll may never be: a circling drag turns
  // camera.up more than it moves the camera. So the move is read off the camera itself.
  if (gliding) controls.update();
  // The threshold also ends the loop at the closest or farthest zoom, where clamping the distance
  // moves the camera by a rounding error on every update().
  const still = STILL_PER_60HZ_FRAME * frames;
  const moved = camera.position.distanceTo(lastPosition) > still * camera.position.distanceTo(controls.target)
    || camera.up.distanceTo(lastUp) > still;
  lastPosition.copy(camera.position);
  lastUp.copy(camera.up);
  const stopping = !(moved || pressed.size > 0);
  if (moved || dirty || (gliding && stopping)) {
    draw();
    dirty = false;
  }
  if (stopping) gliding = false;
  if (document.hidden || !gliding) {
    running = false;
    return;
  }
  requestAnimationFrame(frame);
}

function wake() {
  dirty = true;
  if (running || document.hidden) return;
  running = true;
  last = null;
  requestAnimationFrame(frame);
}

// Fired on a press and on a wheel turn.
controls.addEventListener('start', () => {
  gliding = true;
  wake();
});

// dblclick is not fired for a double tap on every phone, so taps are counted here for mouse
// and finger alike. Only the primary pointer counts, so lifting two fingers is not a double tap.
let down = null;
let lastTap = 0;
// TrackballControls captures the first pointer to the canvas and lets pointer events through, so
// these still see every press and release on it.
canvas.addEventListener('pointerdown', (event) => {
  pressed.add(event.pointerId);
  down = event.isPrimary ? { x: event.clientX, y: event.clientY } : null;
});
canvas.addEventListener('pointercancel', (event) => {
  pressed.delete(event.pointerId);
  if (event.isPrimary) down = null;
});
canvas.addEventListener('pointerup', (event) => {
  pressed.delete(event.pointerId);
  if (!down || !event.isPrimary) return;
  const still = Math.hypot(event.clientX - down.x, event.clientY - down.y) < TAP_SLOP_PX;
  down = null;
  if (!still) {
    lastTap = 0;
    return;
  }
  if (event.timeStamp - lastTap < DOUBLE_TAP_MS) {
    lastTap = 0;
    if (shown) refit(true);
  } else {
    lastTap = event.timeStamp;
  }
});

// The colour is kept in style.css alone, so the canvas and the page cannot drift apart.
function applyTheme() {
  scene.background.set(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  wake();
}

themeButton.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('theme', theme);
  } catch {}
  applyTheme();
});

// Kept per browser like the theme, so someone checking masks finds the mask look still on.
function applyMask(on) {
  masked = on;
  maskButton.setAttribute('aria-pressed', String(on));
  wake();
}

maskButton.addEventListener('click', () => {
  try {
    localStorage.setItem('mask', masked ? 'off' : 'on');
  } catch {}
  applyMask(!masked);
});

for (const button of buttons) {
  button.addEventListener('click', () => select(button.dataset.model));
}
addEventListener('hashchange', () => select(location.hash.slice(1)));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) wake();
});
new ResizeObserver(resize).observe(canvas);

applyTheme();
let savedMask = null;
try { savedMask = localStorage.getItem('mask'); } catch {}
applyMask(savedMask === 'on');
resize();
select(location.hash.slice(1));
