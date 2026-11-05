/* =====================================================================
 * 設定檔 — 部署後只需要改這一個檔案
 * ===================================================================== */

window.APP_CONFIG = {

  /**
   * Apps Script 網頁應用程式網址。
   * 在 Apps Script 按「部署 → 新增部署作業 → 網頁應用程式」後取得，
   * 長得像：https://script.google.com/macros/s/AKfycb..../exec
   */
  GAS_URL: 'https://script.google.com/macros/s/AKfycbyNgRNokrrvkZeUmHAoyvZ_mR86Ja5ZEWaMAoKgR4eyjHzOUOiJG6FmsLlTenHgR7X0/exec',

  /** 活動名稱（顯示在頁首） */
  EVENT_TITLE: '2026原力萌芽 幸福親子園遊會',

  /** 填完之後要不要放一個「回到攤位報名系統」的按鈕；留空就不顯示 */
  HOME_URL: '',

  /**
   * 測試模式：填完的畫面會多一顆「重設這台裝置」，方便自己反覆測試。
   * ⚠️ 活動開始前一定要改回 false。
   */
  TEST_MODE: true
};
