Airport Departure Board

Vision



空港から出発する交通手段を、発車時刻順に1画面で表示する。



既存の時刻表アプリは路線ごと・事業者ごとに分かれており、利用者は複数の時刻表を見比べなければならない。



本プロダクトは「今いる場所から次に利用できる交通手段」を一覧化し、空港からの離脱を効率化する。



Problem



例: 羽田空港第3ターミナル



利用者が知りたいこと



京急とモノレールのどちらが先に出るか

次に利用可能な交通手段は何か

あと何分で出発するか



既存サービスでは



京急時刻表

モノレール時刻表



を別々に見る必要がある。



Core Concept



本アプリの中心概念は「駅」ではなく「場所 (Place)」。



利用者は駅名ではなく、自分がいる場所を選択する。



例:



羽田第1ターミナル

羽田第2ターミナル

羽田第3ターミナル

成田第1ターミナル

成田第2ターミナル



各 Place は複数の交通ソースを持つ。



例:



Place: 羽田第3ターミナル



Sources:



京急 羽田空港第3ターミナル駅

東京モノレール 羽田空港第3ターミナル駅



Place: 羽田第1ターミナル



Sources:



京急 羽田空港第1・第2ターミナル駅

東京モノレール 羽田空港第1ターミナル駅



この設計により、事業者ごとの駅名の違いを吸収する。



MVP

Scope



対象場所



羽田空港第3ターミナル



対象交通機関



京急

東京モノレール

User Flow

羽田第3ターミナルを選択

現在時刻以降の出発便を取得

発車時刻順にマージ

一覧表示

Example Output



羽田第3ターミナル



3分後

京急 品川方面



5分後

モノレール 浜松町方面



12分後

京急 横浜方面



14分後

モノレール 浜松町方面



Functional Requirements

Required

現在時刻以降の便のみ表示

複数ソースの時刻表を統合

発車時刻順にソート

モバイル対応

Display Fields

発車時刻

あと何分

事業者

路線

種別

行き先

Suggested Data Model

Place

type Place = {

&#x20; id: string;

&#x20; name: string;

&#x20; sources: Source\[];

};

Source

type Source = {

&#x20; operator: string;

&#x20; stationId: string;

};

Departure

type Departure = {

&#x20; departureTime: Date;

&#x20; operator: string;

&#x20; line: string;

&#x20; trainType?: string;

&#x20; destination: string;

};

Future Expansion

Phase 2



羽田空港



第1ターミナル

第2ターミナル

第3ターミナル

Phase 3



成田空港



第1ターミナル

第2ターミナル



交通機関



JR

京成

Phase 4



LCB追加



例:



AIRPORT BUS TYO-NRT

Phase 5



General Merged Timetable



任意の交通ソースを組み合わせ可能にする。



例:



JR川崎駅

京急川崎駅



を統合表示。



例:



17:02 京浜東北線 東京方面

17:03 京急本線 品川方面

17:07 東海道線 東京方面



Success Criteria



ユーザーが空港で



「どの交通手段が次に出るか」



を1画面で判断できること。



時刻表を見比べる必要がなくなること。

