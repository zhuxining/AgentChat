import { Streamdown } from "streamdown";

import type { ProjectedMessage } from "@/app/runner-client";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageContent } from "@/components/ui/message";
import { useMarkdownPlugins } from "@/features/chat/use-markdown-plugins";

// Owns how a single transcript message is rendered: both user and assistant messages use
// bubbles; assistant content keeps Markdown, code highlighting, CJK and lazy Mermaid diagrams.
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
          <Bubble align="start" variant="muted">
            <BubbleContent>
              <Streamdown
                mode={streaming ? "streaming" : "static"}
                isAnimating={streaming}
                animated={false}
                plugins={markdownPlugins}
              >
                {message.text}
              </Streamdown>
            </BubbleContent>
          </Bubble>
        )}
        {message.truncated && <span className="text-muted-foreground">（内容已截断）</span>}
      </MessageContent>
    </Message>
  );
}
