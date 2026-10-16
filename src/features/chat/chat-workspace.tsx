import { useState } from "react";

import type { Bot, BotDraft, runnerClient } from "@/app/runner-client";
import { BotEditorDialog } from "@/features/chat/bot-editor-dialog";
import { BotInspector } from "@/features/chat/bot-inspector";
import { ChatPanel } from "@/features/chat/chat-panel";
import { ConversationSidebar } from "@/features/chat/conversation-sidebar";
import { NewChatDialog } from "@/features/chat/new-chat-dialog";
import { SettingsDialog } from "@/features/chat/settings-dialog";
import { useWorkspace } from "@/features/chat/use-workspace";

export function ChatWorkspace({ client }: { client: typeof runnerClient }) {
  const { catalog, selection, connection, feedback, conversation, messaging, actions } =
    useWorkspace(client);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [botDialogOpen, setBotDialogOpen] = useState(false);
  const [chatDialogOpen, setChatDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [search, setSearch] = useState("");
  // Closing animations can keep a dialog mounted; each open must still reset its draft.
  const [editor, setEditor] = useState<{ bot: Bot | null; session: number }>({
    bot: null,
    session: 0,
  });
  const editedBot = editor.bot;

  function newBot() {
    setEditor((previous) => ({ bot: null, session: previous.session + 1 }));
    setBotDialogOpen(true);
  }

  function editBot(bot: Bot) {
    setEditor((previous) => ({ bot, session: previous.session + 1 }));
    actions.selectBot(bot.id);
    setBotDialogOpen(true);
  }

  async function saveBot(draft: BotDraft) {
    const saved = await actions.saveBot(editedBot?.id ?? null, draft, editedBot?.configVersion);
    if (saved && !editedBot) setSearch("");
    return saved;
  }

  if (connection.loading) {
    return (
      <main className="text-muted-foreground grid h-full place-items-center text-sm">
        正在打开 Runner…
      </main>
    );
  }

  return (
    <main className="bg-background text-foreground flex h-full min-h-0 overflow-hidden">
      {sidebarOpen && (
        <ConversationSidebar
          conversations={catalog.conversations}
          conversationId={selection.conversationId}
          latestMessage={selection.snapshot?.messages.at(-1)?.text}
          search={search}
          onSearchChange={setSearch}
          busy={connection.busy}
          onSelect={actions.selectConversation}
          onCollapse={() => setSidebarOpen(false)}
          onNewChat={() => setChatDialogOpen(true)}
          onNewBot={newBot}
          onSettings={() => setSettingsOpen(true)}
        />
      )}
      <ChatPanel
        selection={selection}
        connection={connection}
        feedback={feedback}
        messaging={messaging}
        execution={conversation}
        actions={actions}
        createdAt={
          catalog.conversations.find((item) => item.id === selection.conversationId)?.createdAt ?? 0
        }
        sidebarOpen={sidebarOpen}
        inspectorOpen={inspectorOpen}
        onSidebarOpen={() => setSidebarOpen(true)}
        onInspectorToggle={() => setInspectorOpen((value) => !value)}
        onInspectorOpen={() => setInspectorOpen(true)}
        onSettings={() => setSettingsOpen(true)}
      />
      {inspectorOpen && (
        <BotInspector
          selection={selection}
          connection={connection}
          conversation={conversation}
          actions={actions}
          onEditBot={editBot}
          onSettings={() => setSettingsOpen(true)}
          onClose={() => setInspectorOpen(false)}
        />
      )}
      {catalog.botDefaults && (
        <BotEditorDialog
          key={editor.session}
          open={botDialogOpen}
          bot={editedBot}
          capabilities={catalog.capabilities}
          defaults={catalog.botDefaults}
          busy={connection.busy || connection.runnerUnavailable}
          error={feedback.error}
          onOpenChange={setBotDialogOpen}
          onSave={saveBot}
          onArchive={actions.archiveBot}
        />
      )}
      <NewChatDialog
        open={chatDialogOpen}
        bots={catalog.bots}
        selectedBotId={selection.selectedBotId}
        busy={connection.busy}
        runnerUnavailable={connection.runnerUnavailable || !connection.ready}
        error={feedback.error}
        onOpenChange={setChatDialogOpen}
        onSelectBot={actions.selectBot}
        onStartChat={actions.startChat}
        onNewBot={newBot}
      />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        connection={connection}
        configuration={catalog.configuration}
        feedback={feedback}
        actions={actions}
      />
    </main>
  );
}
