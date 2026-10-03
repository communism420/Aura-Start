const en = {
  notesMigrationFailed: "Your existing notes are safe locally, but could not be transferred yet. Sync will retry.",
  notesSaveFailed: "Notes could not be saved. Keep this page open and retry.",
  notesRetry: "Retry saving",
  restoreNameBeforeNotesChange: "Notes before simultaneous edit",
  widgetNotesDescription: "Markdown notes, included in backups and Google Drive sync when enabled."
};

export const notesTranslations = {
  en,
  ru: {
    notesMigrationFailed: "Старые заметки сохранены локально, но пока не удалось перенести их. Синхронизация повторит попытку.",
    notesSaveFailed: "Не удалось сохранить заметки. Оставьте страницу открытой и повторите попытку.",
    notesRetry: "Повторить сохранение",
    restoreNameBeforeNotesChange: "Заметки до одновременного изменения",
    widgetNotesDescription: "Markdown-заметки с резервным копированием и синхронизацией через Google Drive, если она включена."
  },
  es: {
    notesMigrationFailed: "Tus notas anteriores siguen guardadas localmente, pero aún no se pudieron transferir. La sincronización lo reintentará.",
    notesSaveFailed: "No se pudieron guardar las notas. Mantén esta página abierta e inténtalo de nuevo.",
    notesRetry: "Reintentar guardado",
    restoreNameBeforeNotesChange: "Notas antes de una edición simultánea",
    widgetNotesDescription: "Notas Markdown incluidas en las copias y en la sincronización de Google Drive cuando está activada."
  },
  de: {
    notesMigrationFailed: "Deine bisherigen Notizen sind lokal gesichert, konnten aber noch nicht übertragen werden. Die Synchronisierung versucht es erneut.",
    notesSaveFailed: "Die Notizen konnten nicht gespeichert werden. Lass diese Seite geöffnet und versuche es erneut.",
    notesRetry: "Erneut speichern",
    restoreNameBeforeNotesChange: "Notizen vor gleichzeitiger Bearbeitung",
    widgetNotesDescription: "Markdown-Notizen werden in Backups und bei aktivierter Google-Drive-Synchronisierung gespeichert."
  },
  fr: {
    notesMigrationFailed: "Vos anciennes notes sont conservées localement, mais leur transfert a échoué. La synchronisation réessaiera.",
    notesSaveFailed: "Impossible d’enregistrer les notes. Gardez cette page ouverte et réessayez.",
    notesRetry: "Réessayer l’enregistrement",
    restoreNameBeforeNotesChange: "Notes avant modification simultanée",
    widgetNotesDescription: "Notes Markdown incluses dans les sauvegardes et la synchronisation Google Drive lorsqu’elle est activée."
  },
  pt: {
    notesMigrationFailed: "As notas anteriores estão guardadas localmente, mas ainda não foi possível transferi-las. A sincronização tentará novamente.",
    notesSaveFailed: "Não foi possível guardar as notas. Mantenha esta página aberta e tente novamente.",
    notesRetry: "Tentar guardar novamente",
    restoreNameBeforeNotesChange: "Notas antes de edição simultânea",
    widgetNotesDescription: "Notas Markdown incluídas nas cópias de segurança e na sincronização Google Drive quando ativada."
  },
  uk: {
    notesMigrationFailed: "Старі нотатки збережено локально, але їх поки не вдалося перенести. Синхронізація повторить спробу.",
    notesSaveFailed: "Не вдалося зберегти нотатки. Залиште сторінку відкритою та повторіть спробу.",
    notesRetry: "Повторити збереження",
    restoreNameBeforeNotesChange: "Нотатки до одночасної зміни",
    widgetNotesDescription: "Markdown-нотатки з резервним копіюванням і синхронізацією Google Drive, якщо її ввімкнено."
  }
} satisfies Record<"en" | "ru" | "es" | "de" | "fr" | "pt" | "uk", Record<keyof typeof en, string>>;
