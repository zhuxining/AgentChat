import { runnerClient } from "@/app/runner-client";
import { ChatWorkspace } from "@/features/chat/chat-workspace";

export default function App() {
  return <ChatWorkspace client={runnerClient} />;
}
