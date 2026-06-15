# Airport Departure Board MVP

羽田空港第3ターミナルから出発する京急と東京モノレールを、現在時刻以降の発車時刻順に統合表示する静的Webアプリです。

## 起動

Windowsでは、リポジトリ直下の `start.bat` をダブルクリックすると、ローカルWebサーバーを起動して既定のブラウザを開きます。既にサーバーが起動している場合もブラウザを開きます。サーバーを終了する場合は、最小化されているPythonウィンドウを閉じます。

手動で起動する場合は、以下のようにローカルWebサーバーでリポジトリのルートを配信し、`index.html` を開きます。

例:

```powershell
py -m http.server 4173
```

その後、`http://localhost:4173` にアクセスします。

## 時刻表データ

表示プリセットは [`data/catalog.json`](./data/catalog.json)、時刻表はPlace・運行区分別JSONに手入力します。

- `catalog.json`: Place、Source、Filter、運行区分別ファイルの対応
- `hnd_t3_weekday.json`: 羽田第3の平日データ
- `hnd_t3_holiday.json`: 羽田第3の土休日データ
- `departures`: `sourceId`でSourceに紐づく各出発便
- `defaultFilter.trainTypes`: 初回表示する列車種別
- `defaultFilter.destinations`: 初回表示する行き先
- ユーザーFilter: Place別にlocalStorageへ保存し、defaultFilterより優先
- `departureTime`: 深夜0時台を前営業日の続きとして扱う場合は `24:08` のように入力可能
- `arrivalInfo`: 空港プリセット用の任意の参考到着時刻。未設定の場合は表示しない

現在入っている時刻表と到着情報は画面動作確認用のサンプルであり、実際の時刻ではありません。公開前に正確なデータへ差し替えてください。

データ更新後は次のコマンドでJSONを検証します。

```powershell
node scripts/validate-data.mjs
```

現在の曜日判定は月曜から金曜を平日、土曜・日曜を土休日として扱います。祝日・年末年始・臨時ダイヤの判定は未実装です。午前4時までは前日の営業日として扱います。

内部モデルの責務と拡張方針は [`docs/design.md`](./docs/design.md) を参照してください。
時刻表データの更新手順は [`docs/data-management.md`](./docs/data-management.md) を参照してください。
