# modelviewer

maskeditor で修正する対象物体の形を、ブラウザで回しながら確かめるためのビューア。
物体を選ぶと画面いっぱいに表示され、ドラッグで回して見られる。PC・スマホ・タブレットで開ける。
右上の ▣ を押すと、いまの視点から塗ったマスクを maskeditor と同じ色の付け方（中はクラスの色を 18% 重ね、
輪郭はクラスの色そのまま）で重ねる。回すとマスクも付いてくる。もう一度押すと元の見た目に戻る。
色は dragon が gray_dragon、teapot が blue_pot、bunny が yellow_bunny のもの。
物体は写真の中の物体と同じくらいの暗さの灰色で描く（画面での R, G, B の平均がおよそ 107、写真のマスクの中の中央値）。
明るい灰色の上では 18% の色がほとんど見えなかった。
輪郭の太さは写真の2画素ぶん（maskeditor は1画素。本人の求めで太くした）。物体の長辺がデータセットの写真でのふだんの長辺（マスクの外接矩形の長辺の中央値）に
写るとして、カメラの近さだけから決める。写真の画素の大きさはカメラの遠さで決まり物体の向きでは変わらないので、
回しても太さは変わらず、近づけると太くなる（maskeditor で拡大したときと同じ）。右上の ◐ は背景の明暗を切り替える。

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
- **teapot**：three.js 0.185.1 の `examples/jsm/geometries/TeapotGeometry.js`（MIT）を `tools/teapot.mjs` で動かして作る。
  形は Martin Newell の Utah teapot（Bézier パッチのデータ）。`TeapotGeometry.js` は vendor には入れない
- **three.js** 0.185.1（`static/vendor/three/`、MIT。`LICENSE` を同じ所に置いてある）：npm の `three@0.185.1` から、
  `build/three.module.min.js`・`build/three.core.min.js` と、`examples/jsm/` の
  `controls/OrbitControls.js`・`loaders/GLTFLoader.js`・`utils/BufferGeometryUtils.js`・`utils/SkeletonUtils.js` を
  そのまま写した。版は `static/vendor/three/VERSION` にもある
