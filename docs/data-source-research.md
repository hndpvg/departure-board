# 羽田空港第3ターミナル 時刻表データソース調査

調査日: 2026-06-14

対象:

- 京急 羽田空港第3ターミナル駅
- 東京モノレール 羽田空港第3ターミナル駅

## 結論

- 両社とも、公式サイトからたどれるHTML時刻表で、発車時刻・種別・行先を取得できる。
- 両社とも列車別の停車駅ページがあり、京急は品川・大門、東京モノレールは浜松町の到着時刻も取得できる。
- JSONへの変換は技術的に可能。
- 公開アプリの自動データ取得元として無許諾でスクレイピングすることは推奨しない。
  - 京急は、事前許諾なしでサイト情報を他サイト等へ転用することを控えるよう求めている。
  - 東京モノレールが公式導線として使用するNAVITIME時刻表は、コンテンツの複製・改変・二次的著作物作成・解析行為等を禁止している。
- 実データ化は、まず事業者またはデータ提供者から利用許諾を得る。許諾後は、利用者の画面表示時に取得するのではなく、低頻度バッチで取得・検証・JSON生成する構成を推奨する。

## 必要な取得項目

現在の内部モデルへ変換するため、最低限次を取得する。

```ts
type ArrivalInfo = {
  stationName: string;
  arrivalTime: string;
};

type Departure = {
  id: string;
  sourceId: string;
  departureTime: string;
  operator: string;
  line: string;
  trainType?: string;
  destination: string;
  serviceDays: string[];
  arrivalInfo?: ArrivalInfo[];
};
```

## 京急

### 公式ページURL

駅情報ページ:

- https://www.keikyu.co.jp/ride/kakueki/KK16.html

対象方向は、空港線上り・京急蒲田方面。URLパラメータでは `d=1`。

詳細表示の時刻表:

- 平日  
  https://norikae.keikyu.co.jp/transit/norikae/T5?USR=PC&dw=0&slCode=253-6&d=1&rsf=&SJ=1&tFlg=0
- 土曜  
  https://norikae.keikyu.co.jp/transit/norikae/T5?USR=PC&dw=1&slCode=253-6&d=1&rsf=&SJ=1&tFlg=0
- 休日  
  https://norikae.keikyu.co.jp/transit/norikae/T5?USR=PC&dw=2&slCode=253-6&d=1&rsf=&SJ=1&tFlg=0

駅掲示時刻表PDF:

- https://www.keikyu.co.jp/ride/kakueki/pdf/timetable/KK16.pdf

列車別停車駅ページ:

- T5詳細表示内の各便にある `T7?...` リンク
- `tx`、`tm`等の値は便ごと・ダイヤごとに変わるため、URLを組み立てずT5ページのリンクを追跡する。

### 平日・土休日の取得方法

京急は3区分。

| `dw` | 区分 |
| --- | --- |
| `0` | 平日 |
| `1` | 土曜 |
| `2` | 休日 |

MVPでは、3ページを個別に取得して `serviceDays` へ変換する。

```text
dw=0 -> weekday
dw=1 -> saturday
dw=2 -> holiday
```

### HTML構造

レスポンス文字コード:

- `text/html;charset=Shift_JIS`
- UTF-8前提で読むと文字化けするため、Shift_JISとしてデコードする必要がある。

時刻表全体:

```text
#mainContent
  .timemod001
    #time または #time01
      table
        tr
          th.side01       時
          td
            div.syasyubox
```

詳細表示 `SJ=1` を使うと、各便に種別・時刻・正式な行先と列車別ページへのリンクが含まれる。

```html
<div class="syasyubox syasyu1004">
  <a href="T7?...&dw=0&tm=537&date=" class="time" target="_blank">
    ...
  </a>
</div>
```

確認できた種別クラス:

| CSSクラス | 種別 |
| --- | --- |
| `syasyu1001` | 普通 |
| `syasyu1002` | 急行 |
| `syasyu1003` | 特急 |
| `syasyu1004` | 快特 |
| `syasyu1011` | エアポート快特 |

簡略表示では行先が「品」「青」「ア成空」のような略号になる。詳細表示では「品川」「青砥」「成田スカイアクセス線経由成田空港」のような正式表示を取得できるため、詳細表示を使用する方がよい。

列車別T7ページ:

```text
列車種別
最終行先
曜日区分
table
  tr
    td 停車駅
    td 到着時刻
    td 出発時刻
```

T7ページで、羽田空港第3ターミナルから先の品川・大門を含む停車駅と到着時刻を取得できる。停車しない駅は出現しないため、`arrivalInfo`は存在する駅だけ生成する。

### スクレイピング難易度

**中**

取得しやすい点:

- 曜日・方向がURLパラメータで明確。
- `SJ=1`の詳細表示では正式な種別・行先を取得できる。
- T7ページで品川・大門到着時刻を取得できる。
- サーバー描画HTMLで、ブラウザ実行を必要としない。

難しい点:

- Shift_JIS。
- 古いテーブルレイアウトで、意味を示す専用データ属性がない。
- 種別がCSSクラスへ依存する。
- T7リンクの便識別子はダイヤ改正で変わる。
- 取得時にタイムアウトする場合があり、リトライが必要。

### JSON変換可能性

**高**

推奨変換手順:

1. `dw=0/1/2`の詳細表示T5ページを取得する。
2. 各時間行の時と、各便の分・種別・行先・T7リンクを抽出する。
3. Source Filterを適用し、表示対象便だけに絞る。
4. 表示対象便のT7ページを取得する。
5. 品川・大門の到着時刻が存在する場合だけ`arrivalInfo`へ追加する。
6. 3曜日区分で同一内容の便を統合し、`serviceDays`をまとめる。

### 将来のダイヤ改正への耐性

**中**

- 駅ページの `KK16` と `slCode=253-6` は比較的安定しているが、保証されたAPI識別子ではない。
- T7の`tx`等は改正時に変わる前提で、毎回T5から再取得する必要がある。
- ページには改正日が表示されるため、改正日の変化を更新トリガーにできる。
- 調査時点で、T5 HTMLは平日を含め「2025年12月13日改正」と表示する一方、駅掲示PDFは「土休日: 2025年12月13日改正 / 平日: 2025年12月15日改正」と表示していた。改正日文字列だけを完全な正解として扱わず、データ差分も検査する必要がある。
- PDFはレイアウト・色・記号の解析が必要になるため、HTML取得不能時の手動確認用とする。

### 利用条件

[京急 ウェブサイトご利用案内](https://www.keikyu.co.jp/website-guide.html)では、サイト情報の複製は私的使用の範囲に限定され、事前許諾なしの他サイト等への転用を控えるよう求めている。

公開アプリへ取得結果を掲載する前に、京急へ利用許諾を確認する必要がある。

## 東京モノレール

### 公式ページURL

公式駅ページ:

- https://www.tokyo-monorail.co.jp/guidance/kokusaisen/

駅ページの時刻表リンク先:

- https://train-cloud.navitime.biz/tokyo-monorail/railroads?station=00009590

対象方向は浜松町方面。

- `station=00009590`
- `directional-railroad=00000783-up`

時刻表:

```text
https://train-cloud.navitime.biz/tokyo-monorail/railroads/timetables
  ?station=00009590
  &directional-railroad=00000783-up
  &date=YYYY-MM-DD
```

例:

- 平日の例  
  https://train-cloud.navitime.biz/tokyo-monorail/railroads/timetables?station=00009590&directional-railroad=00000783-up&date=2026-06-15
- 土休日の例  
  https://train-cloud.navitime.biz/tokyo-monorail/railroads/timetables?station=00009590&directional-railroad=00000783-up&date=2026-06-14

旧駅掲示時刻表PDF:

- 平日  
  https://www.tokyo-monorail.co.jp/news/pdf/timetable2024/haneda3_1.pdf
- 土休日  
  https://www.tokyo-monorail.co.jp/news/pdf/timetable2024/haneda3_2.pdf

旧PDFは現在も取得可能だが、「2024年3月16日ダイヤ改正」と記載されている。調査時点の現行NAVITIME時刻表とは時刻が異なるため、実データ生成元には使用しない。

### 平日・土休日の取得方法

東京モノレールの現行HTML時刻表は、曜日区分パラメータではなく `date=YYYY-MM-DD` で日付を指定する。

- 平日の日付を指定すると「平日」時刻表を返す。
- 土曜・日曜・休日の日付を指定すると「土・休日」時刻表を返す。
- `date`を省略するとアクセス日の時刻表を返す。
- `datetime`、`year/month/day`では時刻表の日付は切り替わらず、`date`だけが有効だった。

実運用では、毎回「次の平日」と「次の土休日」を計算して2ページ取得する方法が分かりやすい。ただし年末年始や臨時ダイヤを扱うには、実際の対象日ごとの取得が必要。

### HTML構造

公式駅ページは、NAVITIME提供の時刻表へリンクしている。

路線・方向選択ページ:

```html
<table>
  <tr>
    <th id="railroad-東京モノレール">東京モノレール</th>
    <td>
      <a href="/tokyo-monorail/railroads/timetables
        ?station=00009590
        &directional-railroad=00000783-up">
        浜松町 方面
      </a>
    </td>
  </tr>
</table>
```

時刻表ページ:

```text
table
  thead
    th 時
    th 平日 または 土・休日
  tbody
    tr
      th 時
      td
        ul
          li
            a 列車別停車駅ページ
              span 分
```

各便のリンク:

```text
/tokyo-monorail/railroads/timetables/stops
  ?station=00009590
  &datetime=2026-06-15T11:04:00+09:00
  &train-id=02510050
```

時刻表ページ内の凡例で、種別と表示色を確認できる。

| 表示色・枠 | 種別 |
| --- | --- |
| 黒 | 普通 |
| オレンジ | 区間快速 |
| 赤 | 空港快速 |

列車別停車駅ページ:

- 列車種別・行先がページタイトルと本文に含まれる。
- 各停車駅がリスト形式で並ぶ。
- 時刻は `<time datetime="...">` で表現される。
- 浜松町の到着時刻を取得できる。

ページはNuxtによるアプリだが、調査時点では時刻表と停車駅データがサーバー描画HTMLにも含まれており、JavaScript実行なしで解析可能。

### スクレイピング難易度

**中〜高**

取得しやすい点:

- UTF-8。
- `date=YYYY-MM-DD`で対象日を指定できる。
- 各便のURLにISO 8601形式の発車日時と`train-id`が含まれる。
- 列車別ページの`time[datetime]`から浜松町到着時刻を取得できる。
- サーバー描画HTMLにデータが含まれる。

難しい点:

- 東京モノレール公式ドメインではなく、NAVITIMEのサービスへ依存する。
- Nuxt・Tailwind由来のクラス名は、画面改修で変わりやすい。
- `train-id`は日付・ダイヤごとに変わるため保存して再利用できない。
- 内部に`/apiv1/`が存在するが、公開APIではない。
- 利用条件で解析行為や複製・改変等が禁止されている。

### JSON変換可能性

**高**

推奨変換手順:

1. 対象日の浜松町方面時刻表ページを取得する。
2. 時間行と各便リンクから発車日時・`train-id`を取得する。
3. 凡例と便表示から種別を取得する。
4. Source Filterで空港快速・区間快速だけに絞る。
5. 表示対象便の停車駅ページを取得する。
6. 浜松町の到着時刻を`arrivalInfo`へ追加する。

内部`/apiv1/`を直接利用すれば構造化データを取得できる可能性があるが、公開APIではなく、利用条件で解析行為が禁止されているため採用しない。

### 将来のダイヤ改正への耐性

**中**

- `station=00009590`と`directional-railroad=00000783-up`は現在のサービス内では安定して見えるが、公開仕様ではない。
- `train-id`は都度時刻表ページから取得する。
- 日付指定により、改正日や特殊ダイヤを日単位で取得できる可能性がある。
- HTMLクラスではなく、リンクURL、`datetime`属性、見出しテキスト、駅名を基準に解析する方が変更に強い。
- 公式駅ページからNAVITIME時刻表リンクを再発見する処理を持てば、リンク先変更を検出しやすい。
- 旧PDFの固定URLは更新されず古いデータが残る可能性があるため、現行判定には使用しない。

### 利用条件

現行時刻表の[ご利用にあたって](https://train-cloud.navitime.biz/tokyo-monorail/terms-of-use)では、コンテンツについて次の行為を禁止している。

- 商業的利益を求めること
- 複製、頒布、公衆送信、改変、翻訳、翻案、二次的著作物の作成
- リバースエンジニアリングその他の解析行為

また、[東京モノレール公式サイト利用規約](https://www.tokyo-monorail.co.jp/policy/)も、掲載データの複製・転用・転載・電磁的加工・送信・頒布・二次利用等を断っている。

公開アプリへ取得結果を掲載する前に、東京モノレールおよび必要に応じてNAVITIMEへ利用許諾を確認する必要がある。

## 比較

| 項目 | 京急 | 東京モノレール |
| --- | --- | --- |
| 発車時刻HTML | あり | あり |
| 種別・行先 | 詳細表示T5で取得可能 | 時刻表・列車詳細で取得可能 |
| 到着時刻 | T7で品川・大門を取得可能 | 停車駅ページで浜松町を取得可能 |
| 曜日指定 | `dw=0/1/2` | `date=YYYY-MM-DD` |
| 文字コード | Shift_JIS | UTF-8 |
| HTML形式 | 古いテーブルHTML | Nuxtのサーバー描画HTML |
| JSON変換可能性 | 高 | 高 |
| 技術的難易度 | 中 | 中〜高 |
| 無許諾利用 | 非推奨 | 非推奨 |

## 推奨する取得方法

### 推奨案: 許諾を得た低頻度バッチ取り込み

1. 京急、東京モノレール、必要に応じてNAVITIMEへ、時刻表データを取得・加工して統合表示するサービスであることを伝え、利用許諾を確認する。
2. 許諾を得られた場合のみ、事業者別providerを作る。
3. 取得はユーザーアクセス時ではなく、管理用バッチとして低頻度で実行する。
4. providerの出力を共通Departure JSONへ正規化する。
5. 前回データとの差分、便数、始発・終発、種別、行先、到着時刻を検証する。
6. 大きな差分は手動確認後に公開する。
7. 公開時は取得日時、対象ダイヤ、予定時刻であることを表示する。

### providerごとの推奨入力

京急:

- T5の`SJ=1`詳細表示を3曜日分取得する。
- Source Filter適用後の便だけT7を取得する。
- PDFは改正日の目視確認と異常時の照合に使用する。

東京モノレール:

- NAVITIME時刻表HTMLを対象日指定で取得する。
- Source Filter適用後の便だけ停車駅ページを取得する。
- 内部`/apiv1/`は使用しない。
- 旧PDFは現行データ生成には使用しない。

### 許諾前に可能な作業

- HTMLを保存・転載せず、取得器のインターフェースと検証ルールだけ設計する。
- 権利処理済みのサンプルHTMLまたは手入力fixtureでparserをテストする。
- 事業者へ送る利用許諾問い合わせ文面を作成する。
- 駅すぱあと API、NAVITIME API等のライセンス済みAPIも並行して見積もる。

### 推奨しない方法

- ブラウザから公式ページを直接呼ぶ。
- 利用者の画面表示ごとに公式ページをスクレイピングする。
- NAVITIMEの内部`/apiv1/`を解析して直接利用する。
- PDFの色や配置だけを頼りに自動変換する。
- ダイヤ改正後に自動検証なしでJSONを即時公開する。

## ダイヤ改正に備えた検証ルール

最低限、生成JSONに対して次を検証する。

- Sourceごとの便数が0件ではない。
- IDが重複しない。
- 発車時刻が昇順である。
- 始発・終発が前回から大幅に変化していない。
- 未知の種別・行先が出現した場合は失敗させる。
- Filter対象便に必要な到着駅が存在するか確認する。
- 到着時刻が発車時刻より前になっていない。
- 前回との差分件数が閾値を超えた場合は手動確認する。
- 公式ページURL、方向、曜日区分、対象日、取得日時をメタデータとして保存する。

## 参考URL

- [京急 羽田空港第3ターミナル駅](https://www.keikyu.co.jp/ride/kakueki/KK16.html)
- [京急 駅掲示時刻表PDF](https://www.keikyu.co.jp/ride/kakueki/pdf/timetable/KK16.pdf)
- [京急 ウェブサイトご利用案内](https://www.keikyu.co.jp/website-guide.html)
- [東京モノレール 羽田空港第3ターミナル駅](https://www.tokyo-monorail.co.jp/guidance/kokusaisen/)
- [東京モノレール 現行時刻表入口](https://train-cloud.navitime.biz/tokyo-monorail/railroads?station=00009590)
- [東京モノレール時刻表 ご利用にあたって](https://train-cloud.navitime.biz/tokyo-monorail/terms-of-use)
- [東京モノレール公式サイト 利用規約](https://www.tokyo-monorail.co.jp/policy/)
- [東京モノレール旧平日時刻表PDF](https://www.tokyo-monorail.co.jp/news/pdf/timetable2024/haneda3_1.pdf)
- [東京モノレール旧土休日時刻表PDF](https://www.tokyo-monorail.co.jp/news/pdf/timetable2024/haneda3_2.pdf)
