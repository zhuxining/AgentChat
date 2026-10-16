import { useWorkspaceContext } from "@/app/workspace-provider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// Validates nothing itself: the workspace keeps the draft and owns save/complete semantics.
export function GoalEditor() {
  const { selection, connection, conversation, actions } = useWorkspaceContext();
  const snapshot = selection.snapshot;
  if (!snapshot) return null;
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void actions.saveGoal();
      }}
    >
      <Textarea
        aria-label="工作目标"
        placeholder="记录这次聊天要完成的工作"
        value={conversation.goalDraft}
        onChange={(event) => conversation.setGoalDraft(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          type="submit"
          disabled={
            connection.busy ||
            connection.runnerUnavailable ||
            conversation.goalDraft === snapshot.goal.description
          }
        >
          保存
        </Button>
        <Button
          size="sm"
          type="button"
          variant="outline"
          disabled={
            connection.busy || connection.runnerUnavailable || !snapshot.goal.description.trim()
          }
          onClick={() =>
            void actions.setGoalStatus(snapshot.goal.status === "open" ? "completed" : "open")
          }
        >
          {snapshot.goal.status === "open" ? "确认完成" : "重新打开"}
        </Button>
      </div>
    </form>
  );
}
