import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { parseDoc } from "../../src/lib/markdown";
import { getMermaid } from "../../src/lib/mermaid";
import { ShikiCodeBlock } from "../../src/components/reader/ShikiCodeBlock";
import "../../src/index.css";
import "./quicklook.css";

declare global {
  interface Window {
    renderQuickLook: (markdown: string) => void;
  }
}

function MermaidBlock({ code, dark }: { code: string; dark: boolean }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let alive = true;
    getMermaid(dark)
      .then((mermaid) => mermaid.render(`ql-${crypto.randomUUID()}`, code.trim()))
      .then(({ svg: result }) => alive && setSvg(result))
      .catch(() => alive && setSvg(""));
    return () => { alive = false; };
  }, [code, dark]);

  return svg
    ? <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svg }} />
    : <pre><code className="language-mermaid">{code}</code></pre>;
}

function safeHtml(html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("img").forEach((image) => image.removeAttribute("src"));
  return template.innerHTML;
}

function Renderer() {
  const [source, setSource] = useState("");
  const [dark, setDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  const parsed = useMemo(() => parseDoc(source), [source]);

  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setDark(query.matches);
    query.addEventListener("change", update);
    window.renderQuickLook = setSource;
    return () => {
      query.removeEventListener("change", update);
      delete (window as Partial<Window>).renderQuickLook;
    };
  }, []);

  return (
    <main className={dark ? "dark" : ""}>
      <article className="md-body">
        {parsed.segments.map((segment, index) => {
          if (segment.kind === "html") {
            return <div key={index} dangerouslySetInnerHTML={{ __html: safeHtml(segment.html) }} />;
          }
          if (segment.kind === "table") {
            return <div className="md-table-wrap" key={index}>
              <div className="md-table-inner" dangerouslySetInnerHTML={{ __html: safeHtml(segment.html) }} />
            </div>;
          }
          if (segment.kind === "code") {
            return <ShikiCodeBlock key={index} code={segment.code} lang={segment.lang} />;
          }
          return <MermaidBlock key={index} code={segment.code} dark={dark} />;
        })}
      </article>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Renderer />);
