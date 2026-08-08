# Spotify Glassmorphism Design System

This document outlines the core styling principles for achieving the premium "Spotify Glassmorphism" aesthetic across the application. 
Use this as a reference when styling new components or migrating older UI elements to ensure a cohesive, modern look and feel.

## Core Principles

1. **Ambient & Blurred Backdrops**
   Always try to derive ambient color or background images from the content (e.g., track covers, artist photos). Combine these dynamic backgrounds with heavy backdrop blurs.
   
2. **Glassmorphism Panels**
   For zero states, dropdowns, pills, or cards, use translucent layers instead of solid colors. This creates depth and feels premium.
   - **Background**: `rgba(20, 20, 32, 0.4)` to `rgba(255, 255, 255, 0.05)` (depending on context).
   - **Border**: Thin, subtle white or accent borders: `1px solid rgba(255, 255, 255, 0.05)` or `rgba(255, 255, 255, 0.1)`.
   - **Blur**: Aggressive backdrop blurs: `backdrop-filter: blur(20px)` up to `blur(32px)`.
   - **Shadows**: Soft but pronounced shadows to lift elements: `box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4)`. Also use inset shadows to give a 3D glass edge: `inset 0 1px 0 rgba(255, 255, 255, 0.05)`.

## Empty States & Zero States
- **Avoid Dashed Borders**: Never use dashed utility borders for drag-and-drop zones. Use the Glassmorphism Panel styles above.
- **Center Focus**: Centralize input elements in empty states rather than pinning them to a top navigation bar.
- **Micro-Animations**: Hovering over a glass panel should scale it up slightly (`transform: translateY(-4px)`) and increase the border opacity and shadow spread.

## Examples

### The Glass Dropdown
```css
.dropdown {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  backdrop-filter: blur(32px);
  -webkit-backdrop-filter: blur(32px);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.05);
}
```

### The Gradient Button
```css
.btn {
  background: linear-gradient(135deg, rgba(var(--accent-rgb), 0.8), rgba(var(--accent-rgb), 0.5));
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 8px 24px rgba(var(--accent-rgb), 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1);
  border-radius: 40px;
}
.btn:hover {
  background: linear-gradient(135deg, rgba(var(--accent-rgb), 1), rgba(var(--accent-rgb), 0.8));
  box-shadow: 0 12px 32px rgba(var(--accent-rgb), 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2);
}
```
