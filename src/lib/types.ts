export type Category = {
  id: number;
  user_id: string | null;
  name: string;
  icon: string;
  color: string;
  is_default: boolean;
};

export type Expense = {
  id: number;
  user_id: string;
  category_id: number;
  receipt_batch_id: number | null;
  amount: number;
  description: string | null;
  notes: string | null;
  date: string; // YYYY-MM-DD
  person_id?: number | null;
};

export type Person = {
  id: number;
  user_id: string;
  name: string;
  color: string;
  is_shared: boolean;
  sort_order: number;
};

export type FixedCost = {
  id: number;
  user_id: string;
  category_id: number;
  name: string;
  amount: number;
  frequency: "monthly" | "biweekly" | "weekly" | "yearly";
  is_active: boolean;
};

export type Budget = {
  id: number;
  user_id: string;
  category_id: number;
  monthly_limit: number;
};

export type ReceiptBatch = {
  id: number;
  user_id: string;
  merchant: string | null;
  scanned_at: string;
  total_extracted: number | null;
  notes: string | null;
};

export type ScanLineItem = {
  description: string;
  amount: number;
  category_name: string;
  notes: string;
};

export type ScanResult = {
  merchant: string;
  date: string; // YYYY-MM-DD
  total: number;
  line_items: ScanLineItem[];
};
