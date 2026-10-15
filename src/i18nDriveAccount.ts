import type { AuraLanguage } from "./types";

const en = {
  googleDriveConnectedAccount: "Connected Google account",
  googleDriveAccountDetailsPending: "Account details are not available yet. Aura Start will try again automatically."
};

type AccountTranslations = Record<keyof typeof en, string>;

export const driveAccountTranslations = {
  en,
  ru: {
    googleDriveConnectedAccount: "Подключённый аккаунт Google",
    googleDriveAccountDetailsPending: "Информация об аккаунте пока недоступна. Aura Start попробует получить её автоматически."
  },
  es: {
    googleDriveConnectedAccount: "Cuenta de Google conectada",
    googleDriveAccountDetailsPending: "Los datos de la cuenta aún no están disponibles. Aura Start volverá a intentarlo automáticamente."
  },
  de: {
    googleDriveConnectedAccount: "Verbundenes Google-Konto",
    googleDriveAccountDetailsPending: "Die Kontodaten sind noch nicht verfügbar. Aura Start versucht es automatisch erneut."
  },
  fr: {
    googleDriveConnectedAccount: "Compte Google connecté",
    googleDriveAccountDetailsPending: "Les informations du compte ne sont pas encore disponibles. Aura Start réessaiera automatiquement."
  },
  pt: {
    googleDriveConnectedAccount: "Conta Google ligada",
    googleDriveAccountDetailsPending: "As informações da conta ainda não estão disponíveis. O Aura Start tentará novamente de forma automática."
  },
  uk: {
    googleDriveConnectedAccount: "Підключений акаунт Google",
    googleDriveAccountDetailsPending: "Інформація про акаунт поки недоступна. Aura Start спробує отримати її автоматично."
  }
} satisfies Record<AuraLanguage, AccountTranslations>;
