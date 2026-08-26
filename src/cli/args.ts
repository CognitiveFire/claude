/** Minimal argument parser. A CLI this small does not need a dependency. */

export interface ParsedArgs {
  readonly command: string;
  readonly flags: Readonly<Record<string, string | boolean>>;
  readonly positional: readonly string[];
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const [command = 'help', ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]!;
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const body = token.slice(2);
    const equalsIndex = body.indexOf('=');
    if (equalsIndex !== -1) {
      flags[body.slice(0, equalsIndex)] = body.slice(equalsIndex + 1);
      continue;
    }
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[body] = next;
      i += 1;
    } else {
      flags[body] = true;
    }
  }

  return { command, flags, positional };
}

export function requireString(args: ParsedArgs, name: string): string {
  const value = args.flags[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`--${name} is required.`);
  }
  return value.trim();
}

export function optionalString(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

export function optionalInt(args: ParsedArgs, name: string): number | null {
  const value = optionalString(args, name);
  if (value === undefined) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) throw new Error(`--${name} must be an integer.`);
  return parsed;
}

export function flag(args: ParsedArgs, name: string): boolean {
  return args.flags[name] === true || args.flags[name] === 'true';
}

export function list(args: ParsedArgs, name: string, fallback: readonly string[]): readonly string[] {
  const value = optionalString(args, name);
  if (value === undefined) return fallback;
  return value.split(',').map((entry) => entry.trim()).filter((entry) => entry !== '');
}
