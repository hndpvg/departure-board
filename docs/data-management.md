# 時刻表データ管理

## 方針

当面は、確認済みの時刻表を手入力JSONとしてリポジトリ内で管理する。
ブラウザは公式サイトを直接参照せず、`data-provider.js`を通じてローカルJSONを読み込む。

データ処理の流れ:

```text
getDepartures(placeId, serviceType)
  -> 対象JSONを読み込む
  -> Sourceの有効判定とFilterを適用する
  -> Source情報を補完してDepartureを生成する
  -> UIへ返す
```

## データ格納場所

```text
data/
  catalog.json
  hnd_t3_weekday.json
  hnd_t3_holiday.json
```

- `catalog.json`: Place、Source、Filter、運行区分別ファイルの対応表
- `{placeId}_{serviceType}.json`: 手入力する発車・参考到着データ
- `weekday`: 平日
- `holiday`: 土曜・日曜・祝日

将来は同じ規則で `hnd_t1_weekday.json`、`nrt_t1_holiday.json` などを追加する。
ファイル名ではアンダースコア、内部IDでは既存規則に合わせてハイフンを使用する。

運行区分の選択肢と表示名は`catalog.json`の`serviceTypes`で管理する。Placeごとの
`schedules`に登録された運行区分だけが画面のセレクタへ表示される。

```json
"serviceTypes": [
  { "id": "weekday", "label": "平日" },
  { "id": "holiday", "label": "土休日" }
]
```

Sourceの初期表示設定は`defaultEnabled`と`defaultFilter`で管理する。初回表示ではこの設定を
使い、ユーザーが表示設定を変更した後はPlace別のlocalStorage設定を優先する。

```json
{
  "defaultEnabled": true,
  "defaultFilter": {
    "trainTypes": ["空港快速", "区間快速"],
    "destinations": ["浜松町"]
  }
}
```

Filter候補は選択中Place・運行区分のDepartureからSource別に生成する。保存Filter内に現在の
候補に存在しない種別・行先がある場合は無視する。

## データ構造

運行区分別ファイル:

```json
{
  "metadata": {
    "schemaVersion": 1,
    "placeId": "hnd-t3",
    "serviceType": "weekday",
    "version": "2026-06-sample",
    "lastUpdated": "2026-06-14",
    "status": "sample"
  },
  "departures": []
}
```

`version`は対象ダイヤを識別する値とする。実データ投入時は、原則としてダイヤ改正年月
（例: `2026-03`）を使用する。同月内で訂正する場合は `2026-03-r2` のように枝番を付ける。

`lastUpdated`はJSONを最後に確認・更新した日を `YYYY-MM-DD` で記録する。
`status`は準備用データでは `sample`、公式時刻表と照合済みなら `verified` とする。

同じファイル内でSourceごとのデータ状態が異なる場合、ファイル全体の`status`を`mixed`とし、
`metadata.sources`へSource別の状態を記録する。

```json
"sources": {
  "monorail-hnd-t3": {
    "status": "manual",
    "version": "2026-06-14",
    "lastUpdated": "2026-06-14"
  },
  "keikyu-hnd-t3": {
    "status": "sample",
    "version": "2026-06-sample",
    "lastUpdated": "2026-06-14"
  }
}
```

## 入力形式

### 京急

```json
{
  "id": "keikyu-hnd-t3-1118-01",
  "sourceId": "keikyu-hnd-t3",
  "departureTime": "11:18",
  "trainType": "快特",
  "destination": "品川",
  "arrivalInfo": [
    { "stationName": "品川", "arrivalTime": "11:31" },
    { "stationName": "大門", "arrivalTime": "11:39" }
  ]
}
```

京急では、Source Filterに登録された行先だけが表示対象になる。品川・大門の時刻は固定加算で生成せず、
品川・大門側の駅時刻表または列車詳細から同一列車を照合できた場合だけ`arrivalInfo`へ設定する。
片方だけ照合できた場合は、確認できた地点だけを表示する。

### 東京モノレール

```json
{
  "id": "monorail-hnd-t3-1204-01",
  "sourceId": "monorail-hnd-t3",
  "departureTime": "12:04",
  "trainType": "空港快速",
  "destination": "浜松町",
  "arrivalInfo": [
    { "stationName": "浜松町", "arrivalTime": "12:17" }
  ]
}
```

東京モノレールでは、現在のSource Filterにより空港快速・区間快速だけが表示される。

### 共通ルール

- `id`はファイル内で一意にする。
- `sourceId`は`catalog.json`に存在するSourceを指定する。
- 時刻は`HH:MM`形式とし、深夜0時台を前日の続きとして扱う場合は`24:xx`を使用できる。
- `operator`、`line`、Source色は入力しない。データ取得層がSourceから補完する。
- `arrivalInfo`がない便ではプロパティ自体を省略できる。
- `arrivalInfo.arrivalTime`は既存UI互換用の時刻フィールドである。将来`time`へ移行する場合も、
  ProviderとUIは両方を読める状態を維持する。
- 参考地点時刻は、列車詳細、参考地点駅時刻表、手動確認値の順に採用する。
- 固定所要時間の単純加算や列車種別別の固定加算は使用しない。
- 同一列車を取得・照合できない場合は`arrivalInfo`を出力しない。
- 到着時刻は発車時刻以降であることを手動確認する。
- `arrivalInfo`は終点一覧ではなく、利用者が列車を比較するための参考到着地点
  （reference stops）的な補助情報として扱う。
- 経路や乗り場を識別できる場合は、任意の`routeName`、`trackGroup`、`platform`、`via`を
  Departureへ追加できる。
- 列車愛称付き列車の号数は任意の文字列`serviceNumber`へ入力する。号数がない列車では省略する。

`arrivalInfo`の由来情報:

```json
{
  "stationName": "品川",
  "arrivalTime": "11:31",
  "timeType": "departure",
  "source": "station-timetable",
  "confidence": "matched"
}
```

- `timeType`: `arrival`は実到着時刻、`departure`は参考地点での発車時刻。
- `source`: `train-detail`は列車詳細、`station-timetable`は参考地点駅時刻表、
  `manual`は公式資料を確認した手入力・手動補正。
- `confidence`: `matched`は高確度照合、`probable`は複数条件からほぼ同一、
  `manual`は手動補正。

同一列車の照合では`serviceNumber`を最優先し、続いて`trainType`、`destination`、`routeName`、
空港駅の`departureTime`、停車駅順、参考地点側の時刻を使用する。複数候補が残る場合は
実時刻として確定せず、`arrivalInfo`を出力しない。

現在の実装は、東京モノレール・京急・京成・JRについて、出発駅時刻表の各便から列車詳細ページを
直接取得する。これにより駅時刻表同士の推測照合を避け、詳細ページに存在する参考地点だけを
`train-detail / matched`として出力する。

スカイライナーは公式専用時刻表の「号」列と空港第2ビル発時刻を照合し、全便の`serviceNumber`を確定する。
成田エクスプレスも`serviceNumber`がある便だけ`arrivalInfo`を許可する。

参考地点側駅時刻表による`station-timetable`照合は、列車詳細を取得できない場合の次段階とする。
一般列車では種別・行先・経路・時刻範囲から候補が一意になった場合だけ使用できる。スカイライナーと
成田エクスプレスは`serviceNumber`完全一致が必要で、`probable`照合を許可しない。

## 表示カテゴリと色

`trainType`は利用者へ表示する種別名およびFilter対象として維持する。色は`trainType`へ
直接紐付けず、Sourceの`trainTypeCategories`から解決される`displayCategory`で管理する。
これは色が列車種別そのものではなく、利用者の乗車判断カテゴリを表すためである。

現在のカテゴリ:

- `keikyu-fast`: 京急の快特・エアポート快特、青系
- `keikyu-express`: 京急の特急・急行、緑系
- `monorail-rapid`: 東京モノレールの空港快速・区間快速、オレンジ系
- `keisei-skyliner`: 京成スカイライナー、紫系
- `keisei-access`: 京成アクセス特急、オレンジ系
- `keisei-mainline`: 京成本線系統の快速特急・特急、緑系
- `jr-nex`: JR成田エクスプレス、赤系
- `local-rail`: 快速・普通など一般列車、グレー系
- `default`: 未定義カテゴリ、濃いグレー系

カテゴリ割当は`catalog.json`の各Sourceにある`trainTypeCategories`、色は`styles.css`の
`--category-*` CSS変数で変更する。Departure自身に`displayCategory`がある場合は、
実データ側の明示値を優先できる。

## 運行系統表示

`operator`は事業者名、`operatorLabel`は発車標の行先上部へ表示する運行系統名として分ける。
Sourceに既定の`operatorLabel`を持たせ、Departureに明示値がある場合はProviderがそちらを
優先する。`operatorLabel`は表示だけを担当し、Filter、`trainType`、`displayCategory`へ
影響しない。

現在の基本表示:

- 京急: `京急`
- 東京モノレール: `東京モノレール`
- 京成スカイライナー・アクセス特急: Departureで`スカイアクセス`を明示
- 京成本線系列車: Source既定値の`京成本線`
- JR成田エクスプレス・快速・普通: Source既定値の`JR`

実データ投入時は、利用者が経路を判断しやすい運行系統名を優先する。京成Sourceを将来分割
する場合も、Sourceごとの既定`operatorLabel`を設定することで同じUI表示契約を維持できる。

## 参考到着地点

`arrivalInfo`に設定する駅は、Place・Source・trainTypeごとの利用判断に合わせて選ぶ。
終点である必要はなく、すべての停車駅を格納するものでもない。
入力・レビュー基準となる候補は、catalogのSourceに`referenceStops`として定義できる。
`*`は全種別共通、種別名のキーは種別ごとの候補を表す。実際の表示は各Departureの
`arrivalInfo`に存在する駅だけとする。

```json
"referenceStops": {
  "スカイライナー": ["日暮里"],
  "アクセス特急": ["押上", "日本橋", "日暮里"]
}
```

- 羽田第3・京急: 品川、大門
- 羽田第3・東京モノレール: 浜松町
- 成田第2・京成スカイライナー: 日暮里
- 成田第2・JR成田エクスプレス: 東京
- 成田第2・京成アクセス特急: 実際に通る押上、日本橋、日暮里
- 成田第2・京成本線系統: 実際に通る押上、日本橋、日暮里

成田第2の京成は`keisei-access-nrt-t2`と`keisei-mainline-nrt-t2`へSource分離している。
Departureの`routeName`は取得元確認と将来表示のため維持する。ホームを安定して取得できる場合は、
`platform`を便単位で追加する。

## 東京モノレール土休日データ初回投入時の知見

- 参照した時刻表:
  `https://train-cloud.navitime.biz/tokyo-monorail/railroads/timetables?station=00009590&directional-railroad=00000783-up&date=2026-06-14`
- 参照日・指定日: 2026-06-14（日曜）
- 2026-06-14指定の土休日時刻表では、羽田空港第3ターミナルから浜松町方面が201便あった。
- 内訳は空港快速88便、区間快速2便、普通111便。
- JSONには普通を含む全便を保持し、表示時にSource Filterで空港快速・区間快速だけへ絞る。
- 各便の浜松町到着時刻は、公式時刻表から辿れる停車駅一覧と照合して入力した。
- 最終便は0:10発・0:26着だった。営業日単位で正しく並べるため、JSONでは`24:10`発・`24:26`着へ正規化した。
- 公式ページの日付指定値と、JSONの`metadata.sources`に記録する確認日を残しておく必要がある。
- Source単位で実データ投入を進める間は、ファイル全体の`metadata.status`を`mixed`にする。

## ダイヤ改正時の更新手順

1. 公式時刻表で改正日と平日・土休日の区分を確認する。
2. 対象JSONを複製して作業用ブランチで更新する。
3. 発車時刻、種別、行先、参考到着時刻を入力する。
4. `metadata.version`、`lastUpdated`、`status`を更新する。
5. `node scripts/validate-data.mjs`を実行する。
6. 公式時刻表と、始発・終発・便数・主要時間帯を再照合する。
7. アプリを起動し、Source Filter適用後の表示を確認する。
8. 平日と土休日の両方をレビューして公開する。

ダイヤ改正前にJSONを準備する場合、切替日を自動判定する仕組みは現時点ではない。
公開タイミングでJSONを置き換えるか、将来`effectiveFrom`対応を追加する必要がある。

## JSON検証方法

```powershell
node scripts/validate-data.mjs
```

検証対象:

- JSONとして読み込めること
- Place、serviceType、Source参照の整合性
- Departure IDの重複
- 発車・到着時刻の形式
- 必須項目の存在
- `arrivalInfo`の駅名・時刻と、`timeType`・`source`・`confidence`の許可値

この検証は内容が公式時刻表と一致することまでは保証しない。公開前の目視照合は必須。

## Place追加手順

1. `catalog.json`へPlaceとSourceを追加する。
2. SourceごとのFilter、色、駅名を設定する。
3. 平日・土休日JSONを追加する。
4. UIのPlace選択方法を追加する。現在は`app.js`の`PLACE_ID`固定。
5. 検証スクリプトと画面で確認する。

画面ではPlace選択を`departure-board:place`、運行区分を
`departure-board:service-type:{placeId}`、Filterを
`departure-board:filters:{placeId}`へ保存する。

## 複数Place・表示設定UI

Place一覧は`catalog.json`の`places`から生成する。現在の検証用Place:

- `hnd-t3`: 羽田空港 第3ターミナル
- `nrt_t2`: 成田空港 第2ターミナル

成田第2は成田スカイアクセス線、京成本線、JR、エアポートバス東京・成田のSourceを持ち、
`nrt_t2_weekday.json`と`nrt_t2_holiday.json`に実データスナップショットを格納している。

Filterの優先順位:

1. `departure-board:filters:{placeId}`に保存されたユーザーFilter
2. Sourceの`defaultEnabled`と`defaultFilter`
3. 候補全件を表示

候補は選択中Place・運行区分の全DepartureからSource別に生成する。ユーザーFilterの値が
候補に存在しない場合、その値は無視する。「初期設定に戻す」でユーザーFilterを削除し、
SourceのdefaultFilterへ戻す。

表示設定UIの駅見出しは`source.displayName`を優先し、未設定時は`line + stationName`を使用する。
路線名だけでなく駅名まで表示し、対象時刻表を判別できるようにする。

Departure Boardの参考地点は共通の横並びスロットで比較する。東京モノレールの浜松町は、
京急の大門と同じ右側スロットへ配置し、画面全体の列数は増やさない。

羽田第3で東京モノレールの普通を表示する手順:

1. Placeで「羽田空港 第3ターミナル」を選択する。
2. 「表示設定」を開く。
3. 東京モノレールの種別で「普通」をONにする。

一般マージ時刻表へ拡張する場合、現在のPlaceプリセット単位のFilter保存だけでなく、
ユーザーが任意Sourceを組み合わせた構成自体を保存するモデルが必要になる。また、運行区分を
またいだ候補差分、Sourceの方向・ホーム、同名種別の事業者差、設定の移行方法も検討が必要。

年末年始・特別ダイヤを追加する場合は、`serviceTypes`へ表示名を追加し、対象Placeの
`schedules`へJSONパスを追加する。手動選択は自動的に利用可能になる。日付からの自動判定も
必要な場合は、`app.js`の`detectServiceType()`へ判定条件を追加する。

羽田第3と同程度の2交通ソースを持つ成田Placeを1つ追加する場合、時刻表の手入力・照合を
除く実装作業は約0.5から1日。データ入力と到着目安の照合は、便数と資料品質により
1から3日程度を見込む。

## 将来の自動生成構想

自動生成へ移行する場合も、公開成果物は現在と同じ運行区分別JSONにする。

```text
公式提供データ・許諾済みAPI・管理用入力
  -> provider別変換
  -> 共通形式へ正規化
  -> validate-data相当の検証
  -> 前版との差分レビュー
  -> data/へ公開
```

UIと`getDepartures()`の契約を維持すれば、手動JSON、半自動生成JSON、APIを切り替えても
画面側への影響を抑えられる。

## 一般マージ時刻表へ発展する際の課題

- `app.js`で固定しているPlace選択をユーザー設定へ変更する必要がある。
- 土休日だけでなく、土曜・祝日・臨時ダイヤ・適用開始日を表現する必要がある。
- Sourceごとの方向、ホーム、停車駅、運休、遅延などの共通モデルが必要になる。
- `arrivalInfo`を空港プリセット専用補助情報のままにするか、経路・停車駅モデルへ昇格するか判断が必要。
- 同名駅・同名行先・事業者をまたぐID体系とデータ品質レビューの運用が必要になる。
## 成田第2ターミナルの京成データ投入

京成データは公式時刻表の取得元ページに合わせ、成田スカイアクセス線と京成本線を別Sourceへ投入する。

- 成田スカイアクセス線ページ: `keisei-access-nrt-t2`
- 京成本線ページ: `keisei-mainline-nrt-t2`

取得元に存在する列車は種別にかかわらず全件をDepartureへ投入する。初期表示対象は
Sourceの`defaultFilter`で制御し、取得処理では快速・普通・通勤特急・ライナー等を除外しない。
表示するかどうかはFilter、取得して保持するかどうかはデータ取得層の責務である。

Sourceは経路・乗り場判断の単位、`displayCategory` は色分けの単位であり、役割を混同しない。
同じSource内でも列車種別に応じて異なるdisplayCategoryを使用できる。

Departureの `routeName` はSourceと重複して見える場合も削除しない。公式データとの照合、
レビュー時の誤分類検出、将来の経路表示に使用するためである。ホーム情報が取得できる場合は
Departureの任意フィールド `platform` へ追加し、Source単位ではなく便単位で管理する。

## 参考比較地点の管理

`arrivalInfo` は利用者が交通手段を比較するための参考地点と、その地点における確認済みの実到着時刻
または実発車時刻を保持する。時刻の意味と由来は`timeType`、`source`、`confidence`で明示する。

エアポートバス東京・成田は、公式PDFに記載された成田空港第2ターミナル発と東京駅の
便別到着予定時刻を列位置で対応付け、`arrivalInfo`へ設定する。
UI上の種別表示は簡潔に`バス`とし、Source名と`airport-bus`カテゴリは維持する。

- 東京駅行: 東京駅を表示
- 銀座駅行: 東京駅の時刻が取得できる場合だけ東京駅を表示

値は公式PDFから抽出した予定時刻で、固定加算は使用しない。抽出結果は
`data/tyo-nrt-arrivals.json`へ保存し、`manual / manual`として扱う。道路状況によって実時刻は
変動するため、データ更新時はPDFの改訂日と時刻表を確認する。

スカイライナーと成田エクスプレスの号数は任意フィールド `serviceNumber` に格納する。
UIでは号数が存在する場合だけ「スカイライナー105号」のように表示する。
成田エクスプレスは列車詳細上で複数の終着駅を確認できた場合、`新宿・大船`のように
`destination`を結合して表示する。
参考地点の東京時刻は同一号数内の複数系統を比較し、最も早い東京発時刻を採用する。

## スマホ表示と初期表示Filter

スマホではOSのステータスバーに現在時刻があるため、アプリ内の現在時刻・日付はCSSメディアクエリで
非表示にする。操作行は運行区分、設定、更新を小さくまとめる。

Departure行では種別・行先を上段の主情報、路線・駅を下段の補助情報として表示する。

`defaultFilter`は初期表示のための設定であり、データ取得対象を制限しない。現在の主な初期表示:

- 羽田第3・京急: 品川、青砥、押上、泉岳寺、京成高砂、京成佐倉、成田空港、印旛日本医大、
  印西牧の原、成田スカイアクセス線経由成田空港、京成成田、芝山千代田、宗吾参道
- 成田第2・成田スカイアクセス線: スカイライナー、アクセス特急
- 成田第2・京成本線: 快速特急、特急、通勤特急、モーニングライナー
- 成田第2・JR: 成田エクスプレスのみ。快速・普通はデータ保持し、表示設定からONにできる。

`arrivalInfo.timeType`はUI表示に使用し、`arrival`は「着」、`departure`は「発」を時刻横へ表示する。


## 2026-06 成田第2データ管理の追加ルール

`nrt_t2`に`keisei-higashi-narita-nrt-t2`を追加し、京成東成田線・東成田駅のSourceとして管理する。東成田駅は成田第2ターミナルから徒歩アクセス可能な補助的Sourceとし、芝山千代田方面は今回のデータ投入対象から除外する。

東成田駅Sourceは`defaultEnabled: true`とし、`defaultFilter.trainTypes`で`普通`と`快速`を初期OFFにする。対象列車はJSONに保持し、ユーザーが表示設定から有効化できる状態を維持する。成田の京成系Sourceでは宗吾参道を`defaultFilter.destinations`から外し、データには保持する。

エアポートバス東京・成田は`defaultEnabled: false`とし、初期表示では非表示にする。データと東京駅の`arrivalInfo`は保持する。

Source識別色はカタログのSource定義の`color`で管理する。成田スカイアクセス線は`#f97316`、京成本線は`#2563eb`、京成東成田線は`#38bdf8`とする。

成田JRの参考地点は東京のみとし、新宿の`arrivalInfo`は生成しない。UIではJR成田線の東京参考時刻を右側スロットに表示する。


## 2026-06 祝日判定・初期Filter・到着優先表示

運行区分の自動判定は`app.js`の`detectServiceType()`で行う。判定優先順は、localStorageの手動選択、日本の祝日・振替休日・国民の休日、土日、`weekday`の順とする。判定したserviceTypeが利用できない場合は、利用可能な先頭のserviceTypeへフォールバックする。

参考地点時刻は到着時刻を優先して表示する。列車詳細・停車駅情報で到着時刻が取得できる場合は`timeType: "arrival"`とし、到着時刻がなく発車時刻だけが取得できる場合は`timeType: "departure"`とする。UIでも同じ駅に複数候補がある場合は到着を優先して1件だけ表示する。

京成東成田線の表記は、`displayName`、`shortName`、Filter見出し、Source表示で「京成東成田線」を使う。成田のエアポートバス東京・成田は初期表示OFFを維持する。宗吾参道と京成成田は成田の京成系Sourceの初期表示から外すが、データに存在する場合は保持する。
