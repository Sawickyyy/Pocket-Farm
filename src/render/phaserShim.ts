import Phaser from 'phaser';

// Phaser 4.1.0: SpriteGPULayer (i kilka filtrów) odwołuje się do globalnego `Phaser`,
// który istnieje tylko w buildzie UMD. W ESM (Vite) trzeba go wystawić ręcznie.
// Naprawione w Phaserze 4.2 – po aktualizacji ten plik można usunąć.
const g = globalThis as typeof globalThis & { Phaser?: typeof Phaser };
g.Phaser ??= Phaser;
