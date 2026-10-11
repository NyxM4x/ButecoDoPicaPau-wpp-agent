// Campana de cocina con Web Audio: no necesita ningún archivo de sonido.
// El navegador solo deja sonar después de un clic del usuario, por eso el
// tablero tiene un botón para activarla.

let context: AudioContext | null = null;

export async function enableChime(): Promise<boolean> {
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') await context.resume();
    return context.state === 'running';
  } catch {
    return false;
  }
}

export function playChime(): void {
  if (!context || context.state !== 'running') return;
  const start = context.currentTime;
  for (const [index, frequency] of [880, 1175, 1568].entries()) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const at = start + index * 0.16;
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.55);
  }
}
