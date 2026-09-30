import { createInterface, emitKeypressEvents } from 'node:readline';
export async function readAdminInput(): Promise<unknown> {
  if (!process.stdin.isTTY) {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk.toString();
      if (Buffer.byteLength(input) > 8192) throw new Error('Input too large');
    }
    return JSON.parse(input);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (question: string) => new Promise<string>(resolve => rl.question(question, resolve));
  const name = await ask('Nome: ');
  const email = await ask('Email: ');
  rl.close();
  process.stdout.write('Senha (mínimo 12 caracteres, entrada oculta): ');
  const password = await new Promise<string>((resolve, reject) => {
    let value = '';
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const cleanup = () => { process.stdin.off('keypress', listener); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); };
    const listener = (text: string | undefined, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === 'c') { cleanup(); reject(new Error('Cancelled')); }
      else if (key.name === 'return' || key.name === 'enter') { cleanup(); resolve(value); }
      else if (key.name === 'backspace') value = [...value].slice(0, -1).join('');
      else if (!key.ctrl && text && !/[\x00-\x1f\x7f]/.test(text) && value.length < 256) value += text;
    };
    process.stdin.on('keypress', listener);
  });
  return { name, email, password };
}
