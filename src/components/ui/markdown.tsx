import { Fragment } from "react";

/**
 * A deliberately tiny markdown renderer for the Claude audit text.
 *
 * It handles paragraphs, bullets, headings and bold — which is everything the
 * brief prompt asks for. Pulling in a full markdown pipeline and a sanitizer to
 * render four constructs would be more attack surface and more bundle for no
 * gain, and the text is never rendered as HTML here: every node is a React
 * child, so nothing in it can execute.
 */
export function Markdown({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);

  return (
    <div className="space-y-3 text-sm leading-relaxed text-ink">
      {blocks.map((block, index) => {
        const lines = block.split("\n");

        if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
          return (
            <ul key={index} className="list-disc space-y-1.5 pl-5">
              {lines.map((line, i) => (
                <li key={i}>
                  <Inline text={line.replace(/^\s*[-*]\s+/, "")} />
                </li>
              ))}
            </ul>
          );
        }

        const heading = block.match(/^(#{1,4})\s+(.*)$/);
        if (heading) {
          return (
            <p key={index} className="label-micro pt-2">
              {heading[2]}
            </p>
          );
        }

        return (
          <p key={index}>
            <Inline text={block.replace(/\n/g, " ")} />
          </p>
        );
      })}
    </div>
  );
}

/** Splits on `**bold**` and renders the halves. Nothing else is interpreted. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);

  return (
    <>
      {parts.map((part, index) => {
        const bold = part.match(/^\*\*([^*]+)\*\*$/);
        return bold ? (
          <strong key={index} className="font-semibold">
            {bold[1]}
          </strong>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        );
      })}
    </>
  );
}
