// Static FAQ corpus shared by the /settings/help page and the
// Ask-the-AI server action. Hand-curated. Keep entries concise — Gemini
// uses these as the corpus for free-form questions when local search misses.

export type FaqEntry = {
  question: string;
  answer: string;
  keywords: string[];
};

export const FAQ_ENTRIES: FaqEntry[] = [
  // ── Adding expenses ────────────────────────────────────────────
  {
    question: "How do I add an expense?",
    answer:
      "Tap the green + button at the bottom of the screen and pick 'Expense'. Fill in the amount, pick a category, and save. The amount, date, and category are required.",
    keywords: ["add", "expense", "log", "spending", "purchase", "new"],
  },
  {
    question: "Can I edit an expense after saving?",
    answer:
      "Yes — tap any expense in the History tab or in a budget drill-down to open the editor. Change the amount, category, date, or notes, then Save.",
    keywords: ["edit", "change", "modify", "expense", "fix"],
  },
  {
    question: "How do I delete an expense?",
    answer:
      "Open the expense (tap it in History) and use the Delete button at the bottom of the editor. To delete several at once, use Bulk edit in the History tab.",
    keywords: ["delete", "remove", "expense", "trash"],
  },

  // ── Scanning receipts ──────────────────────────────────────────
  {
    question: "How do I scan a receipt?",
    answer:
      "Tap the round green camera button at the bottom of the screen, then 'Take a photo' or 'Upload from gallery'. The AI reads the receipt, extracts every line item, and lets you review and tweak before saving.",
    keywords: ["scan", "receipt", "camera", "photo", "ai", "ocr"],
  },
  {
    question: "Why didn't my receipt scan?",
    answer:
      "Common causes: photo too dark, receipt cropped, or HEIC not supported on your browser. Make sure the receipt is well-lit, in focus, and that you can see all line items. If the camera doesn't return the photo (Samsung quirk), tap 'Upload from gallery' instead.",
    keywords: ["scan", "failed", "broken", "receipt", "samsung", "android"],
  },
  {
    question: "Will my receipts be saved as photos?",
    answer:
      "No — receipts are scanned in memory and not stored. Only the extracted line items, merchant, date, and totals are saved.",
    keywords: ["receipt", "photo", "stored", "saved", "privacy"],
  },
  {
    question: "Are receipt-scanned items grouped together in history?",
    answer:
      "Yes. In the Expenses tab, items from the same receipt appear under one collapsible header showing merchant + total. Each line item is independently editable.",
    keywords: ["grouped", "history", "receipt", "batch", "collapsed"],
  },
  {
    question: "I'm getting a 'daily limit' error when scanning. What gives?",
    answer:
      "There's a 100-scans-per-user-per-day cap to keep AI costs sane. The counter resets 24 hours from your earliest scan today.",
    keywords: ["limit", "cap", "scan", "100", "daily", "rate"],
  },

  // ── Budgets ────────────────────────────────────────────────────
  {
    question: "How do I set a budget?",
    answer:
      "Tap the 'Budgets' tab (or tap '+' → 'Budget'). Pick the category, enter your monthly cap. You'll get push notifications at 50%, 80%, and 100% as you spend.",
    keywords: ["budget", "limit", "cap", "monthly", "set", "create"],
  },
  {
    question: "How do I change a budget?",
    answer:
      "Open the Budgets tab, tap the category you want to change, and edit the monthly limit. Set it to 0 to remove the budget for that category.",
    keywords: ["edit", "change", "budget", "limit"],
  },
  {
    question: "Why is my budget red?",
    answer:
      "Red means you're over the cap for that category this month. Yellow means you're past 80%. Green is healthy. Tap the budget to see the spending that got you there.",
    keywords: ["red", "over budget", "color", "warning", "yellow"],
  },
  {
    question: "What is budget rollover?",
    answer:
      "When 'Rolls over' is enabled on a budget, unused amounts carry forward to the next month — and overspending eats into next month's limit. Useful for budgets that vary month-to-month like medical or gifts.",
    keywords: ["rollover", "carry forward", "rolls over", "compound"],
  },

  // ── Fixed costs ────────────────────────────────────────────────
  {
    question: "How do I add a fixed cost?",
    answer:
      "Fixed costs are recurring bills (rent, subscriptions, insurance). Tap '+' → 'Fixed cost' to add one. Set the frequency (monthly, biweekly, weekly, yearly) and the system normalizes it to monthly for budgeting.",
    keywords: ["fixed", "bill", "rent", "subscription", "recurring", "monthly cost"],
  },
  {
    question: "What's the difference between an expense and a fixed cost?",
    answer:
      "An expense is a one-time spend (groceries, gas, takeout). A fixed cost is something that hits every month or on a regular schedule (rent, Netflix, insurance). Fixed costs auto-roll into your budget calculations.",
    keywords: ["expense", "fixed", "difference", "compare"],
  },
  {
    question: "How do I pause a fixed cost?",
    answer:
      "Open the fixed cost, uncheck 'Active', and save. It stays in your records but stops counting against budgets. Re-check 'Active' anytime to resume.",
    keywords: ["pause", "inactive", "stop", "fixed cost"],
  },

  // ── Income ─────────────────────────────────────────────────────
  {
    question: "How do I track income?",
    answer:
      "On the home screen there's an Income widget right below the four stat cards. Tap it to add a paycheck, edit existing entries, or delete them. The widget shows Made / Spent / Saved for the current month.",
    keywords: ["income", "paycheck", "salary", "earnings", "money made", "saved"],
  },
  {
    question: "Why is my Saved number red?",
    answer:
      "It means you spent more than you made this month. The widget pulls Spent from your variable expenses + fixed costs; Made from your logged income entries.",
    keywords: ["saved", "red", "negative", "income", "overspent"],
  },
  {
    question: "How do I hide the income widget?",
    answer:
      "Press-and-hold the widget for half a second, then confirm 'Remove from home screen'. To bring it back, go to Settings → Home screen widgets.",
    keywords: ["hide", "remove", "income", "widget", "home screen"],
  },

  // ── Widgets / home screen ─────────────────────────────────────
  {
    question: "Can I rearrange the widgets on my home screen?",
    answer:
      "Yes — press-and-hold any widget to enter edit mode. Drag widgets to reorder them or tap to remove. Hidden widgets re-enable in Settings → Home screen widgets.",
    keywords: ["rearrange", "reorder", "move", "widget", "drag", "home screen"],
  },
  {
    question: "How do I install the app on my phone?",
    answer:
      "On Android Chrome: open the browser menu and tap 'Install app' or 'Add to Home Screen'. On iPhone Safari: tap the Share button (square with arrow), scroll down, tap 'Add to Home Screen'.",
    keywords: ["install", "home screen", "app", "pwa", "shortcut"],
  },

  // ── Notifications ──────────────────────────────────────────────
  {
    question: "Why did I get a notification?",
    answer:
      "Push notifications fire when you cross 50%, 80%, 100%, or 110% of a budget for a category. You can customize these per-budget when editing it. Make sure 'Notifications' is enabled in Settings.",
    keywords: ["notification", "alert", "ping", "push"],
  },
  {
    question: "How do I enable notifications?",
    answer:
      "Settings → 'Notifications' card → tap 'Enable notifications'. Allow the browser prompt. To get them on your phone reliably, install the app to your home screen first.",
    keywords: ["enable", "notification", "push", "allow", "permission"],
  },
  {
    question: "Can I change the notification thresholds?",
    answer:
      "Defaults are 50% / 80% / 100% / 110%. When you edit a specific budget, you can enable custom thresholds for that category if you want different cutoffs.",
    keywords: ["threshold", "notification", "percent", "custom", "alert"],
  },

  // ── Household / people ─────────────────────────────────────────
  {
    question: "Can I see who in my household spent what?",
    answer:
      "Yes — set up household members in Settings → People. Then attribute expenses to a person when adding them, or via the 'Person' filter in the History tab.",
    keywords: ["who", "person", "household", "spent", "attribution"],
  },
  {
    question: "Can two people share the same budget?",
    answer:
      "Not yet — each account has its own private budget. The 'People' feature is for labelling who bought what inside one account, not for syncing budgets across accounts. Tell us via the feedback button if shared household budgets matter to you.",
    keywords: ["share", "household", "multiple", "couple", "joint"],
  },

  // ── Exports ────────────────────────────────────────────────────
  {
    question: "How do I export my data?",
    answer:
      "Settings page → Export buttons. You can grab your data as JSON, Excel, or PDF. A date range picker lets you choose: this month, last month, year-to-date, all time, or custom dates.",
    keywords: ["export", "download", "backup", "json", "excel", "pdf", "date range"],
  },
  {
    question: "Can I get a report for just one month?",
    answer:
      "Yes — Settings → tap an export button → pick 'This month' or 'Last month' or 'Custom' with the exact dates you want.",
    keywords: ["report", "month", "specific", "export", "date"],
  },

  // ── Subscription ───────────────────────────────────────────────
  {
    question: "How much does the app cost?",
    answer:
      "$4 CAD/month after a 7-day free trial. Manage your subscription from Settings → 'Manage subscription'.",
    keywords: ["cost", "price", "subscription", "trial", "free", "$4"],
  },
  {
    question: "How do I cancel?",
    answer:
      "Settings → Manage subscription. You'll be sent to Stripe's customer portal where you can cancel anytime. Your access continues until the end of the current period.",
    keywords: ["cancel", "subscription", "stripe", "stop", "unsubscribe"],
  },

  // ── Help / support ─────────────────────────────────────────────
  {
    question: "How do I report a bug?",
    answer:
      "Settings → 'Got an issue or an idea?' card at the top → tap 'Report a bug or send feedback'. Or use the Send feedback shortcut in the More menu. Your device info gets attached automatically.",
    keywords: ["bug", "report", "feedback", "broken", "issue", "support"],
  },
  {
    question: "What happens after I send feedback?",
    answer:
      "The owner gets a push notification with your report immediately. When they look at it and resolve it, you'll get a push back saying so.",
    keywords: ["feedback", "after", "response", "reply", "resolved"],
  },
  {
    question: "Can the AI help me with a question?",
    answer:
      "Yes — Settings → Help & FAQ → type your question. If no FAQ matches, an 'Ask the AI' button appears (5 free questions per day). The AI answers based on this FAQ.",
    keywords: ["ai", "ask", "help", "question", "bot", "assistant"],
  },
];
