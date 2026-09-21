# 青天井スキャナー

日本株のブレイクアウト戦略「青天井スキャナー」。しこり壁（現在値近辺の出来高集中帯）を大商いで突き抜ける銘柄を検出し、**テクニカル（突破可能性）× ファンダメンタル**の2軸で確認するダッシュボード。

- 公開URL: https://yamanah800-oss.github.io/ai-design-yammy/scanner/
- 株価・出来高: Yahoo Finance の日足を GitHub Actions（サーバー側・CORS回避）で自動取得 → `scanner/data.json`
- 更新: `deploy.yml` により約5分ごと

## ファンダメンタル（J-Quants API）連携の設定

ファンダの数値（売上・営業利益・EPS・PER・ROE・自己資本比率など）は **J-Quants API（JPX公式・無料プランあり）** から取得します。APIキー未設定でもテクニカルと定性チェックは動作します。

### 手順
1. J-Quants に登録し、ダッシュボードで **APIキー** を発行
   - 登録: https://jpx-jquants.com/
   - V2 API はキーを `x-api-key` ヘッダーで送る方式（V1のトークン交換は廃止）
2. GitHub リポジトリの **Settings → Secrets and variables → Actions → New repository secret** で登録
   - Name: `JQUANTS_API_KEY`
   - Secret: 発行したAPIキー
3. 次回のデプロイ（push または5分ごとのスケジュール）で `scanner/fetch-scan.mjs` がファンダを取得し、詳細パネルに数値が表示されます

### 補足（実装メモ）
- エンドポイント: `${JQUANTS_BASE}/fins/summary?code=<証券コード>`（既定 `JQUANTS_BASE=https://api.jpx-jquants.com/v2`）
- 認証: ヘッダー `x-api-key: <APIキー>`
- フィールド名はプランやバージョンで異なる場合があるため、`fetchFundamentals()` は複数の候補キー名にフォールバックします。初回取得後に実レスポンスと合わない項目があれば、`fetch-scan.mjs` の `num('...')` の候補キーを調整してください。
- 無料プランはデータに遅延（数週間程度）がある点に注意。

## 注意
本ダッシュボードは情報提供目的であり、投資判断はご自身の責任で行ってください。
