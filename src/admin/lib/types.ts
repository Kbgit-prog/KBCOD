import type { ShopSettings } from "../../server/services/settings";

export type PublicShopSettings = Omit<ShopSettings, "providers"> & {
  providers: Omit<ShopSettings["providers"], "smsSecretEnc" | "whatsappTokenEnc"> & { hasSmsSecret: boolean; hasWhatsappToken: boolean };
};

export interface Bootstrap {
  shop: { domain: string; name: string | null; currency: string; moneyFormat: string; appClientId: string };
  settings: PublicShopSettings;
  google: { status: string; google_email: string | null; spreadsheet_title: string | null; sheet_title: string | null; enabled: boolean; last_error: string | null } | null;
  alerts: { sheets: number; meta: number; dead: number; uncertain: number };
}

export interface PageProps {
  boot: Bootstrap;
  reloadBoot: () => Promise<void>;
  go: (p: any) => void;
}
