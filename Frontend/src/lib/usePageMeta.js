import { useEffect } from "react";

const SITE = "https://breachradar.fr";

// Titre, description, URL canonique et indexation propres à chaque page de l'application.
export const usePageMeta = ({ title, description, path = "/", noindex = false }) => {
  useEffect(() => {
    const set = (selector, attr, value) => {
      let el = document.head.querySelector(selector);
      if (!el) {
        el = document.createElement(selector.startsWith("link") ? "link" : "meta");
        const [, key, name] = selector.match(/\[(\w+)="([^"]+)"\]/);
        el.setAttribute(key, name);
        document.head.appendChild(el);
      }
      el.setAttribute(attr, value);
    };
    document.title = title;
    if (description) {
      set('meta[name="description"]', "content", description);
      set('meta[property="og:description"]', "content", description);
    }
    set('meta[property="og:title"]', "content", title);
    set('link[rel="canonical"]', "href", `${SITE}${path}`);
    set('meta[property="og:url"]', "content", `${SITE}${path}`);
    set('meta[name="robots"]', "content", noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large");
  }, [title, description, path, noindex]);
};
