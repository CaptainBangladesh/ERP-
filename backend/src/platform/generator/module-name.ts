/**
 * Every name a module needs, derived from the one the person adding it types.
 *
 * A module called `products` produces a `ProductsModule`, a `PRODUCTS_ROUTE`, a `Product`
 * model, a `PRODUCT_PATHS` and a `products` table. Those are five conventions, each obvious
 * on its own and each easy to break at three in the afternoon on the eleventh module — and a
 * module that breaks one is not wrong, it is *inconsistent*, which is the failure that costs
 * something at forty modules and nothing at three.
 *
 * Derived rather than asked for, with one exception: the singular of an English noun is not
 * something a rule gets right, so `record` can be given. `parties` would otherwise produce
 * `Partie`.
 */
export interface ModuleNames {
  /** Lowercase kebab-case, as the directory and the manifest name: `field-service`. */
  readonly name: string;
  /** `FieldService` — the prefix on the Nest module, controller and service classes. */
  readonly pascal: string;
  /** `FIELD_SERVICE` — the prefix on the module's own constants in its contract. */
  readonly constant: string;
  /** The primary record, as a Prisma model: `Product`. */
  readonly record: string;
  /** `PRODUCT` — the prefix on constants about the record rather than about the module. */
  readonly recordConstant: string;
  /** `product` — the Prisma delegate, which is the model with a lowercase first letter. */
  readonly delegate: string;
  /** The table the record maps to, which is the module's own name: `field_service`. */
  readonly table: string;
  /** `field service` — for a sentence in generated prose. */
  readonly words: string;
  /** `product` — the same, for the record. */
  readonly recordWords: string;
  /**
   * The collection key in a generated `_PATHS` object — `products` for a `products` module.
   *
   * Ordinarily this is just the module's own name, camelCased. It takes the record's regular
   * plural instead only when that would collide with `delegate` — an acronym-like module name
   * such as `crm`, or a compound one like `field-service`, camelCases to the same string as
   * its own singular record delegate, and `{ crm: ..., crm: (id) => ... }` is not an object
   * with two keys, it is one key whichever was written second. Every other module's name is
   * already the plural an English speaker would write, so this changes nothing for them.
   */
  readonly plural: string;
}

export const MODULE_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** A Prisma model name as the schema writes it. */
export const RECORD_NAME = /^[A-Z][A-Za-z0-9]*$/;

export function namesOf(name: string, record?: string): ModuleNames {
  const parts = name.split('-');
  const pascal = parts.map(capitalise).join('');
  const primary = record ?? singular(pascal);
  const delegate = primary.charAt(0).toLowerCase() + primary.slice(1);
  const asWritten = camel(name);

  return {
    name,
    pascal,
    constant: parts.map((part) => part.toUpperCase()).join('_'),
    record: primary,
    recordConstant: shout(primary),
    delegate,
    table: parts.join('_'),
    words: parts.join(' '),
    recordWords: words(primary),
    plural: asWritten === delegate ? pluralise(delegate) : asWritten,
  };
}

/** `field-service` → `fieldService`. The module's own name, with its dashes folded in. */
export function camel(name: string): string {
  const [first = '', ...rest] = name.split('-');
  return first + rest.map(capitalise).join('');
}

/**
 * Enough English to be right about the record nouns this system actually uses, and no more —
 * the plural counterpart to `singular`, kept just as narrow. Only reached when the module's
 * own name already collides with its record delegate, so being wrong about an irregular
 * plural here costs one odd-looking object key, not a build that will not compile.
 */
function pluralise(word: string): string {
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  return `${word}s`;
}

/**
 * Enough English to be right about the names this system actually uses, and no more.
 *
 * `products` → `Product`, `parties` → `Party`, `identity` → `Identity`. Anything it gets
 * wrong is corrected by passing `--record`, which is a better answer than a pluralisation
 * library: the generator would then be right about `Mice` and still wrong about somebody's
 * domain noun, having acquired a dependency to be wrong with.
 */
function singular(pascal: string): string {
  if (/ies$/.test(pascal)) return `${pascal.slice(0, -3)}y`;
  if (/(s|x|z|ch|sh)es$/.test(pascal)) return pascal.slice(0, -2);
  if (/[^s]s$/.test(pascal)) return pascal.slice(0, -1);
  return pascal;
}

function capitalise(part: string): string {
  return part.charAt(0).toUpperCase() + part.slice(1);
}

/** `UnitOfMeasure` → `UNIT_OF_MEASURE`. */
function shout(pascal: string): string {
  return pascal.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

/** `UnitOfMeasure` → `unit of measure`. */
function words(pascal: string): string {
  return pascal.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}
