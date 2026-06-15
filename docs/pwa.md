# PWA構成

Airport Departure Boardは、Android ChromeとiPhone Safariからホーム画面へ追加できるPWAとして動作する。

## 構成ファイル

- `manifest.json`: アプリ名、表示モード、テーマ色、アイコンを定義する。
- `service-worker.js`: アプリ資材と時刻表JSONをキャッシュする。
- `icons/icon-192.png`: 192x192のホーム画面アイコン。
- `icons/icon-512.png`: 512x512のホーム画面アイコン。

`display` は `standalone`、テーマ色は `#07111f`、背景色は `#050b14` とする。

## キャッシュ戦略

Service Workerは次のファイルをインストール時にキャッシュする。

- `index.html`
- `app.js`
- `data-provider.js`
- `styles.css`
- `manifest.json`
- 192px / 512pxアイコン
- `data/catalog.json`
- 羽田第3・成田第2の平日 / 土休日JSON

ページ遷移とJSONはネットワーク優先とし、取得成功時にキャッシュを更新する。オフライン時や通信失敗時は
最後に正常取得したキャッシュを返す。CSS、JavaScript、アイコン等はキャッシュ優先で返す。

## 更新方法

アセットやデータを更新した場合は、`service-worker.js` の `CACHE_VERSION` を変更する。
バージョン変更後、次回アクセス時に新しいキャッシュが作られ、旧キャッシュは削除される。

アプリとデータを更新した後は次を実行する。

```powershell
node scripts/update-real-data.mjs
node scripts/validate-data.mjs
```

## アイコン差し替え

同じファイル名・サイズで次のPNGを置き換える。

- `icons/icon-192.png`
- `icons/icon-512.png`

差し替え後は `CACHE_VERSION` を更新する。

## Android Chrome

1. HTTPSで公開されたアプリをChromeで開く。
2. Chromeメニューから「アプリをインストール」または「ホーム画面に追加」を選ぶ。
3. 追加後、ホーム画面のアイコンから起動する。

## iPhone Safari

1. HTTPSで公開されたアプリをSafariで開く。
2. 共有ボタンを押す。
3. 「ホーム画面に追加」を選ぶ。
4. 追加後、ホーム画面のアイコンから起動する。

## 制約

- Service WorkerはHTTPS、または開発用のlocalhostでのみ有効になる。
- `start.bat` のlocalhostは同じPC内の確認用であり、スマートフォンへのインストールにはHTTPS公開が必要。
- オフライン時は最後に取得した時刻表を表示するため、ダイヤ更新後の最新データとは限らない。
- iPhone SafariではAndroid ChromeとインストールUIやキャッシュ管理方法が異なる。
