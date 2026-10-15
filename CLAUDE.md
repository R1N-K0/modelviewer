# modelviewer

標準ライブラリの http.server + three.js（ES module、ビルド無し）。テストは無い。`python app.py` → http://localhost:5100。
使い方は README、設計の理由は各ファイルのコメントにある。

## 崩してはいけないもの

- **`app.py` は標準ライブラリだけ。** 作業者の clone に pip を要求しないため。trimesh などは
  `tools/requirements.txt`（モデルを作るときだけ）に入れ、`app.py` から import しない
- **GLB は git に入れる。** 同じ理由。`tools/make_models.py` で作り直したら、README の表の数も直す。1個 5 MB 以下
- **`.js` の Content-Type は `app.py` の `extensions_map` で明示する。** Windows のレジストリでは `.js` が
  `text/plain` のことがあり、ブラウザは module として動かさない
- **`static/vendor/three/` は npm の1つの版をそのまま写したもの。** 書き換えない。版を上げるなら全ファイルを
  同じ版で入れ替え、`VERSION` と README の版を直す。`three.module.min.js` は `three.core.min.js` を、
  `GLTFLoader.js` は `../utils/BufferGeometryUtils.js` と `../utils/SkeletonUtils.js` を import するので、
  入れ替えたら `grep import` で相対パスが全部あるか確かめる
- **描くのは動いているときだけ。** リモートの Windows で立ち上げっぱなしにし、スマホでも開くため。
  `app.js` のループは autoRotate・ダンピング・ドラッグの間だけ回る。画面を変えるものを足したら `wake()` を呼ぶ
- **画面は下の物体のボタン3つと、右上の背景の切り替えだけ。** ヘルプ・スライダー・設定は足さない。
  色は `style.css` の CSS 変数にだけ書き、`app.js` はそこから `scene.background` を読む

## 進め方

- コメントは**なぜそうしたか**を書く。何をしているかはコードが言う
- コミットメッセージは日本語、タイトルは簡潔に。Claude の署名は入れない
- 変更したら `python app.py` を上げて `curl.exe -sI` で確かめる。**ブラウザ操作はできない**ので、
  見た目の最終確認は本人に頼む
