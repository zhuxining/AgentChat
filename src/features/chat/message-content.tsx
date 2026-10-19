import { Streamdown } from "streamdown";

import type { ProjectedMessage } from "@/app/runner-client";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageContent } from "@/components/ui/message";
import { useMarkdownPlugins } from "@/features/chat/use-markdown-plugins";

// Owns how a single transcript message is rendered: user messages keep the bubble
// treatment, assistant messages render Markdown with code highlighting, CJK and
// lazily-loaded Mermaid diagrams.
export function MessageBody({
  message,
  streaming,
  texts,
}: {
  message: ProjectedMessage;
  streaming: boolean;
  texts: string[];
}) {
  const markdownPlugins = useMarkdownPlugins(texts);
  return (
    <Message align={message.role === "user" ? "end" : "start"}>
      <MessageContent>
        {message.role === "user" ? (
          <Bubble align="end" variant="muted">
            <BubbleContent className="whitespace-pre-wrap">{message.text}</BubbleContent>
          </Bubble>
        ) : (
          <Streamdown
            mode={streaming ? "streaming" : "static"}
            isAnimating={streaming}
            animated={false}
            plugins={markdownPlugins}
          >
            {message.text}
          </Streamdown>
        )}
        {message.truncated && <span className="text-muted-foreground">（内容已截断）</span>}
      </MessageContent>
    </Message>
  );
}
