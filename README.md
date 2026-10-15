# modelviewer

maskeditor で修正する対象物体の形を、ブラウザで回しながら確かめるためのビューア。
物体を選ぶと画面いっぱいに表示され、ゆっくり回る。PC・スマホ・タブレットで開ける。

公開ページ：https://r1n-k0.github.io/modelviewer/ （研究室の外からはこちら、研究室の中では `python app.py` でも同じ）

- `main` に push すると `.github/workflows/pages.yml` が `static/` をそのまま GitHub Pages に出す。Pages では `app.py` は要らない
- GitHub のリポジトリの Settings → Pages の Source は「GitHub Actions」にしておく

## 準備

Python 3.7 以上があればよい（標準ライブラリだけで動くので `pip install` は要らない）。

```
git clone https://github.com/R1N-K0/modelviewer.git
cd modelviewer
copy .env.example .env
python app.py
```

立ち上げると `http://192.168.x.x:5100` のように1行出るので、その住所をスマホやタブレットのブラウザで開く
（`localhost` はスマホ自身を指すので使えない）。この機械の中からなら `http://localhost:5100` でもよい。

- `.env` に書くのは `PORT` だけ（無ければ 5100）。同じ機械でほかのアプリと番号がかぶると、
  `cannot listen on port 5100` と出て止まるので、別の番号にする
- 同じネットワークの機械ならどれからでも開ける。ログインは無いが、見るだけで何も書き換えない
- Windows では、初めて立ち上げたときにファイアウォールの許可を聞かれることがある。許可しないと
  スマホからつながらない。管理者の権限が要るときは、管理者に python の受信を許可してもらう
- 止めるのは Ctrl+C。コードを `git pull` で更新したら立ち上げ直す

## 使い方

- 下のボタン（`dragon`・`bunny`・`teapot`）で物体を選ぶ。選んでいるものは色が濃くなり、読み込み中は薄くなる
- ドラッグ（指1本）で回す。指を離して2秒たつと、また自動で回り出す
- ホイール（指2本でつまむ）で寄る・離れる
- ダブルクリック（ダブルタップ）で最初の向きと距離に戻る
- 右上の `◐` で背景を薄いグレーと暗い色で切り替える。選んだ方はそのブラウザに残る（選んでいなければ端末のダークモードの設定に従う）
- 住所の最後に `#bunny` のように付けると、その物体で開く。ボタンで変えると住所も変わるので、
  そのまま人に送れる

## モデルの作り直し方

`static/models/*.glb` はリポジトリに入っているので、ふだんは作り直さなくてよい。作り直すときだけ、
リポジトリの直下に venv を作る（`.venv/` と、元データを置く `tools/_download/` は git に入らない）。

```
py -3.10 -m venv .venv
.venv\Scripts\python -m pip install -r tools\requirements.txt
.venv\Scripts\python tools\make_models.py
```

`py` が無ければ `python -m venv .venv`。元データ（合わせて約 16 MB）は初回だけ取りに行き、
dragon の読み込みと間引きに2分ほどかかる。最後に三角形数・頂点数・バイト数の表が出る。

| name   | 三角形数 | 頂点数 | バイト数 |
|--------|---------:|-------:|---------:|
| dragon | 150,000  | 74,879 | 3,598,132 |
| bunny  | 69,451   | 34,834 | 1,670,444 |
| teapot | 6,320    | 3,241  | 154,616   |

- dragon は 15 万三角形まで間引く（`fast_simplification`）。bunny と teapot は元のまま
- どれも bounding box の中心を原点、最長辺を 1.0 にそろえ、Y を上にする。Stanford の2つは元から Y が上。
  teapot は元が Z 上なので X 軸まわりに −90° 回す（蓋が上、注ぎ口が +X）
- 頂点法線を計算して GLB に入れる。bunny と dragon の底の穴は埋めていない
- GLB は1個 5 MB 以下でないとスクリプトが止まる

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
