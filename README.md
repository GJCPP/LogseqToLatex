# logseq-to-latex

Generate latex code from current logseq page.

## Demo

![](./demo.gif)

## Functionalities

- Image translation: `![](./assets/1.png)` -> `\includegraphics[width=0.5\textwidth]{1.png}`
- Title translation: `# Hello` -> `\section{Hello}`, etc.
- Environment replacement: `### Proof` -> `\begin{proof} ... \end{proof}`. Note that all sub-block will be put inside the environment.
- Code replacement: ` ```cpp...``` ` -> `\begin{minted}{cpp} ...\end{minted}`. Note that this requires minted package.
- Logseq command replacement, e.g. `collapsed:: true` -> `(empty)`,
    `logseq.order-list-type:: number` -> `\begin{enumerate} ... \end{enumerate}`
