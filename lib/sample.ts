// トップページ (譜面パラメータなし) で表示するチュートリアル譜面。
// 主要機能を★注目コメントで案内するセルフガイド:
// 1小節目=階段 / 2小節目=ジャンプとフリーズ / 3小節目=8分の交差 / 4小節目=締め

export const SAMPLE_COMPACT =
  "1000010000100001-" +
  "1001020003000010-" +
  "10000010000101001000001000010100-" +
  "0100001000001001";

export const SAMPLE_TITLE = "はじめてのStep Analyzer";
export const SAMPLE_SUBTITLE = "★マークが使い方ガイド";
export const SAMPLE_BPM = "120";

// 注目ノーツ (tick = 拍×48) とそのコメント (hc形式: tick:base64url)
export const SAMPLE_HIGHLIGHTS = "0-192-384-720";
export const SAMPLE_COMMENTS =
  "0:44OO44O844OE44KS44K_44OD44OX44GZ44KL44Go6Laz5Ymy44KKIChML1IpIOOBqOS9k-OBruWQkeOBjeOBjOimi-OBiOOBvuOBmeOAguKXgOWJjS_mrKHilrbjgafjgbLjgajjgaTjgZrjgaTov73jgYjjgb7jgZk," +
  "192:4pa244Gn6Ieq5YuV5YaN55Sf44CC8J-Rj-OBruODj-ODs-ODieOCr-ODqeODg-ODl-OChOKZqeOBruODoeODiOODreODjuODvOODoOOCguOBk-OBk-OBi-OCiQ," +
  "384:4pyO57eo6ZuG44Gn6K2c6Z2i44KS5L2c44KM44G-44GZ44CC44OG44Kt44K544OI44GL44KJU00vU1ND44OV44Kh44Kk44Or44Gu5Y-W44KK6L6844G_44KC," +
  "720:5YWx5pyJ44Oc44K_44Oz44Gn44GT44Gu6K2c6Z2i44GU44GoVVJM44Gr44CC8J-Tt-eUu-WDj-OChPCfjqXli5XnlLvjga7mm7jjgY3lh7rjgZfjgoLjgYroqabjgZfjgYLjgow";
