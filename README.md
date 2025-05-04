# ryjs - Real-time Collaborative Editor

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Start the development server:

```bash
npm run dev
```

3. Open http://(your ip address) in your browser.

## Available Scripts

- `npm run dev` - Start the development server
- `npm run build` - Build the project for production
- `npm run lint` - Run ESLint
- `npm run preview` - Preview the production build

## Project Structure

```
ryjs/
├── src/
│   ├── components/     # React components
│   ├── context/        # React context providers
│   ├── App.tsx         # Main application component
│   ├── main.tsx        # Application entry point
│   └── index.css       # Global styles
├── public/             # Static assets
└── vite.config.ts      # Vite configuration
```

## Controls

- **Node Interaction**

  - Mouseover over any node
  - Click any node to permanently select it (click it again to unselect it)
  - Click and drag nodes to reposition them
  - Click and drag in empty space to select multiple nodes with a brush selection

- **Navigation**

  - Mouse wheel to zoom in/out
  - Hold Shift + drag to pan the view

- **Collaboration**
  - See other users' cursors and brushes in real-time
  - Changes are synchronized automatically across all connected users (you see what I see)
