# modelviewer

maskeditor で修正する対象物体の形を、ブラウザで回しながら確かめるためのビューア。
物体を選ぶと画面いっぱいに表示され、ドラッグで回して見られる。PC・スマホ・タブレットで開ける。

公開ページ：https://r1n-k0.github.io/modelviewer/ （研究室の外からはこちら、研究室の中では `python app.py` でも同じ）

- `main` に push すると `.github/workflows/pages.yml` が `static/` をそのまま GitHub Pages に出す。Pages では `app.py` は要らない
- GitHub のリポジトリの Settings → Pages の Source は「GitHub Actions」にしておく


## 取得元とライセンス

**このページは研究用で、非商用。** bunny と dragon を商用に使うには Stanford の許可が要る。
画面の左上の出典の行は、Stanford の条件（出典を書く）のために出している。

- **bunny**（`bun_zipper.ply`）・**dragon**（`dragon_vrip.ply`）：
  [The Stanford 3D Scanning Repository](http://graphics.stanford.edu/data/3Dscanrep/)、Stanford Computer Graphics Laboratory。
  `http://graphics.stanford.edu/pub/3Dscanrep/bunny.tar.gz` と
  `http://graphics.stanford.edu/pub/3Dscanrep/dragon/dragon_recon.tar.gz` から取る。
  研究に使うこと・無償で再配布することは認められている。**商用には使えない**（売る製品に入れるには許可が要る）。
  出典として Stanford Computer Graphics Laboratory を書くこと
- **teapot**（`teapot.obj`）：University of Utah の授業 CS 6620（2013 年秋）の課題の配布物
  `https://graphics.cs.utah.edu/courses/cs6620/fall2013/prj05/teapot.obj`。ライセンスの記載は無い。
  形は Martin Newell の Utah teapot
- **three.js** 0.185.1（`static/vendor/three/`、MIT。`LICENSE` を同じ所に置いてある）：npm の `three@0.185.1` から、
  `build/three.module.min.js`・`build/three.core.min.js` と、`examples/jsm/` の
  `controls/OrbitControls.js`・`loaders/GLTFLoader.js`・`utils/BufferGeometryUtils.js`・`utils/SkeletonUtils.js` を
  そのまま写した。版は `static/vendor/three/VERSION` にもある
