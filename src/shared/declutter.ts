/**
 * Safe, scoped CSS stylesheet to declutter Meta Business Suite and Facebook Page Inbox.
 * Strips away only specific extraneous chrome (left navigation rail, promotional banners,
 * channel switcher tabs, and right customer context card) to retain exclusively
 * the conversation list and active chat window, matching Messenger desktop UX.
 *
 * Safety guarantees:
 * - NO unscoped or parent-level :has() selectors (which accidentally hid parent containers).
 * - NO position, margin, or height overrides on root layout pagelets.
 * - NO theme or color overrides.
 */
export const PAGE_INBOX_DECLUTTER_CSS = `
  /* 1. Hide Global Left Navigation Rail */
  [data-pagelet="LeftNav"] {
    display: none !important;
  }

  /* 2. Hide Top Global Header/Toolbar if present in MBS */
  [data-pagelet="CometBizKitTopNav"],
  [data-pagelet="BizInboxHeader"] {
    display: none !important;
  }

  /* 3. Hide Channel Switcher Tabs in Thread List Header (All messages, IG, WhatsApp) */
  [data-pagelet="GenericBizInboxThreadListViewHeader"] [role="tablist"] {
    display: none !important;
  }

  /* 4. Hide Promotional Banners & Upsell Cards in Conversation View */
  [data-pagelet="BizInboxDetailViewBannerSectionWrapper"],
  [data-pagelet="GenericBizInboxThreadListViewHeader"] > div:nth-child(n+3),
  [data-pagelet="GenericBizInboxThreadListViewHeader"] div[class*="xexx8yu"],
  div[aria-label="Announcements"],
  div[data-testid="announcement_card"] {
    display: none !important;
  }

  /* 5. Hide Right-hand Context Card / Customer Details Sidebar */
  [data-pagelet="BizInboxDetailViewContextCardSectionWrapper"],
  [data-pagelet="BizInboxDetailViewContextCardWrapper"] {
    display: none !important;
  }

  /* 6. Clean Scrollbars */
  ::-webkit-scrollbar {
    width: 8px !important;
    height: 8px !important;
  }
  ::-webkit-scrollbar-track {
    background: transparent !important;
  }
  ::-webkit-scrollbar-thumb {
    background: rgba(128, 128, 128, 0.3) !important;
    border-radius: 4px !important;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: rgba(128, 128, 128, 0.5) !important;
  }
`;
