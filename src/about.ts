import { SPEC, TSUBO } from './data/spec';
import type { WorldStats } from './world';

const PUB = '<span class="pill pub">公開</span>';
const EST = '<span class="pill est">推定</span>';

/** 出典・前提条件（モーダル） */
export function aboutHtml(s: WorldStats): string {
  return `
  <h2>出典・前提条件</h2>
  <p>本モデルは、インターネット上で公開されている建物仕様（貸室面積・天井高・平面形状の記述・設備）をもとに、
  2 階全体を1テナント（オリエントコーポレーション IT・システムグループ／リスク管理グループ）が使用する想定で
  <b>再現・設計した参考モデル</b>です。実際の竣工図・テナント内装図は非公開のため、寸法・室配置・什器・人員配置には推定が含まれます。
  実図面（平面図 PDF 等）があれば <code>src/data/</code> の座標を差し替えるだけで精度を上げられる構造にしています。</p>

  <h3>建物仕様</h3>
  <table>
    <tr><th>所在地</th><td>${SPEC.address} ${PUB}</td></tr>
    <tr><th>事業主／設計／施工</th><td>${SPEC.owner}／${SPEC.design}／${SPEC.construction} ${PUB}</td></tr>
    <tr><th>竣工</th><td>${SPEC.completed} ${PUB}</td></tr>
    <tr><th>規模・高さ</th><td>${SPEC.floors}、最高高さ ${SPEC.height}m、延床 ${SPEC.totalFloorArea.toLocaleString()}㎡、敷地 ${SPEC.siteArea.toLocaleString()}㎡ ${PUB}</td></tr>
    <tr><th>基準階貸室</th><td>${SPEC.typicalRentable.toLocaleString()}㎡（${SPEC.typicalRentableTsubo}坪）、2階も同面積で募集実績あり ${PUB}</td></tr>
    <tr><th>平面形状</th><td>コの字型の無柱オフィス、4分割時 ${SPEC.divisions.join('／')}坪 ${PUB} → 外形 76.8m×38.4m・北側片寄せコア 32.0m×22.4m・3.2mモジュールで再構成 ${EST}</td></tr>
    <tr><th>本モデルの専有面積</th><td>${s.officeNet.toFixed(1)}㎡（${(s.officeNet / TSUBO).toFixed(2)}坪、外周柱型 ${s.columns}本を控除）— 公開値との差 ${(((s.officeNet - SPEC.typicalRentable) / SPEC.typicalRentable) * 100).toFixed(2)}%</td></tr>
    <tr><th>天井高・床</th><td>CH 2,800mm（一部2,600mm）・OAフロア・床荷重500kg/㎡（EV周り1,000kg/㎡）${PUB}</td></tr>
    <tr><th>空調</th><td>個別空調、1フロア30ゾーン ${PUB} → ゾーン割付・カセット位置 ${EST}</td></tr>
    <tr><th>外装</th><td>Low-E複層ガラス、庇、木目調のバルコニー（分割区画ごとに専用バルコニー）${PUB} → 位置・寸法 ${EST}</td></tr>
    <tr><th>昇降機</th><td>乗用7基（27人乗）＋非常用・人荷用2基 ${PUB} → 配置 ${EST}</td></tr>
    <tr><th>給湯室</th><td>専有部出入口前に給湯室・自販機 ${PUB}</td></tr>
    <tr><th>BCP</th><td>非常用発電機 72時間 ${PUB}</td></tr>
    <tr><th>立地</th><td>新宿通り北側の角地、向かいに麹町ミレニアムガーデン（オリコ本社）${PUB} → 周辺形状 ${EST}</td></tr>
  </table>

  <h3>テナント内装の前提 ${EST}</h3>
  <ul>
    <li>在籍 約300名（IT・システムG 約170名／リスク管理G 約130名）、出社率 約65%、グループアドレス＋ABW（集中席・Webブース・ラウンジ）。</li>
    <li>全員がモバイルPCを使用：各席に24型モニター・USB-Cドック、ロッカーにPC充電用コンセント、無線LAN APは約90㎡/台の高密度配置。</li>
    <li>リモート会議が活発：全会議室にディスプレイ＋カメラバー、1人用Webブース ${s.booths1}台・2人用 ${s.booths2}台、Web会議室、ハイバックソファ。画面・ヘッドセットで「Web会議中」の人を表現。</li>
    <li>IT・システムG：SOC（CSIRT）、検証ラボ、ITサポートデスク（キッティング・貸出）、プロジェクトルーム、アジャイル開発エリア。</li>
    <li>リスク管理G：入室制限のモニタリングルーム、書庫（集密書架）、大会議室（可動間仕切りで24名）。</li>
    <li>組織名のうち公開情報で確認できたのは「IT・システムグループ（IT・システム企画部、サイバーセキュリティ室など）」「リスク管理グループ（信用管理部など）」まで。室の用途・名称は想定です。</li>
    <li>方位は新宿通りを東西方向とみなした概略です。日照は 2026年9月28日の太陽位置で計算しています。</li>
  </ul>

  <h3>主な出典（公開情報）</h3>
  <ul>
    <li><a href="https://www.kousaikai.or.jp/2025/08/08/16606/" target="_blank" rel="noopener">公益財団法人 鉄道弘済会「新築オフィスビル『麹町弘済ビルディング』が竣工しました。」</a></li>
    <li><a href="https://www.cbre.co.jp/properties/office/p-113101166011/s-2157517" target="_blank" rel="noopener">CBRE 麹町弘済ビルディング 物件情報</a></li>
    <li><a href="https://office.mecyes.co.jp/office/detail/13/13101/a251000000BEUBxAAP" target="_blank" rel="noopener">三菱地所リアルエステートサービス 物件情報</a></li>
    <li><a href="https://best-tokyo.com/office/items/19090/00042799" target="_blank" rel="noopener">東京ベストオフィス 麹町弘済ビルディング 2階（669.73坪）</a></li>
    <li><a href="https://www.officetar.jp/blog/2024/06/24/koujimachi-kousai-building/" target="_blank" rel="noopener">オフィスター スタログ「麹町弘済ビルディング」</a></li>
    <li><a href="https://sohonavi.jp/building/detail_20272/" target="_blank" rel="noopener">SOHOオフィスナビ 麹町弘済ビルディング</a></li>
    <li><a href="https://www.city.chiyoda.lg.jp/documents/28052/r404kankyokeikakusho-1_1.pdf" target="_blank" rel="noopener">千代田区 建築物環境計画書（(仮称)弘済会館ビル新築工事）</a></li>
    <li><a href="https://skyskysky.net/construction/202570.html" target="_blank" rel="noopener">超高層ビルディング 麹町弘済ビルディング</a></li>
    <li><a href="https://www.orico.co.jp/company/corporate/about/organization/" target="_blank" rel="noopener">オリエントコーポレーション 本社組織</a></li>
  </ul>
  <p style="font-size:11.5px;color:var(--sub)">社名は文字のみで表記し、ロゴ等は使用していません。本モデルは実在の内装・セキュリティ設備を示すものではありません。</p>
  `;
}
