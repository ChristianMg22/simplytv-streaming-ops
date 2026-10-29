# components/ui

`asmr-background.demo.tsx` es el componente real (fondo de partículas con vórtice magnético; React + TypeScript + Tailwind).
`asmr-background.tsx` es el contador de ejemplo que venía en el paquete original.

El tablero **no usa React**: su versión equivalente está en `dashboard/src/particles.js` (canvas nativo, colores por tema,
pausa fuera de pantalla, respeta `prefers-reduced-motion`).

Para usarlo en una app shadcn: copia ambos a `components/ui/` (esa ruta es la convención de shadcn), asegúrate de tener
`@/lib/utils` (`npx shadcn@latest init`), Tailwind y TypeScript, y renderiza `<ASMRStaticBackground />`.
Sin dependencias extra: solo `react`.


## contribution-skyline.tsx
Original React component. In the dashboard it is ported to vanilla canvas (`dashboard/src/skyline.js`) and fed with daily incident counts; it reacts to the explorer filters.


## donut-chart.tsx
Original React component (framer-motion). In the dashboard it is ported to vanilla SVG (`donut()` in `dashboard/src/lib.js`): the hero SLA donut and the three "Composition of the slice" donuts in the Explorer use the same staggered draw-in, hover glow and live center text.


## beams-background.tsx
Original React component (motion). In the dashboard it is ported to a fixed vanilla canvas behind the whole page (`dashboard/src/beams.js`), tinted by the active palette and theme, at half resolution with CSS blur, paused when the tab is hidden.
