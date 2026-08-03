import {
  CurrencyMismatchError,
  Decimal,
  DecimalFormatError,
  DivisionByZeroError,
  DEFAULT_CURRENCY,
  MAX_DECIMAL_DIGITS,
  Money,
  Quantity,
} from '@erp/shared';

/**
 * The exact-number primitives, tested directly rather than through an endpoint.
 *
 * Below the HTTP seam on purpose, and for the same reason `module-contract.spec.ts` and the
 * refusal half of `tenancy.spec.ts` are: the deliverable is a *property*, and most of what
 * establishes it is not reachable over HTTP. There is no route that divides by zero, no route
 * that adds pounds to dollars, and no route that rounds a tie downward — and a rounding mode
 * that is wrong in one direction is exactly the bug that costs a company money quietly over a
 * year rather than loudly on a Tuesday.
 *
 * What *is* observable at the seam is asserted there instead: `api-conventions.spec.ts`
 * covers the wire shape, the round-trip through Postgres, and drift across a year of pay
 * runs.
 */
describe('exact numbers', () => {
  const parse = Decimal.parse;

  describe('arithmetic that a double gets wrong', () => {
    it('adds the canonical example exactly', () => {
      expect(parse('0.1').plus(parse('0.2')).toString()).toBe('0.3');
      expect(0.1 + 0.2).not.toBe(0.3);
    });

    it('keeps every digit through a multiplication', () => {
      // The scale is the sum of the operands', so nothing is discarded and nothing has to be
      // decided about what to discard.
      expect(parse('1.05').times(parse('1.05')).toString()).toBe('1.1025');
      expect(parse('0.07').times(parse('100')).toString()).toBe('7.00');
    });

    it('does not drift across ten thousand additions', () => {
      let running = Decimal.ZERO;
      for (let index = 0; index < 10_000; index += 1) running = running.plus(parse('0.01'));

      expect(running.toString()).toBe('100.00');
    });

    it('subtracts to exactly zero', () => {
      expect(parse('4076.71').minus(parse('4076.71')).isZero()).toBe(true);
      // And a zero is never signed, whatever produced it.
      expect(parse('0.00').minus(parse('0.00')).toString()).toBe('0.00');
      expect(parse('-0.00').toString()).toBe('0.00');
    });
  });

  describe('rounding, which only happens where it is asked for', () => {
    it('refuses to divide without being told how to round', () => {
      // Not an assertion about a runtime check — there is no signature that would compile.
      // @ts-expect-error a division with no rounding is not expressible
      expect(() => parse('1').dividedBy(parse('3'))).toThrow();
    });

    it('refuses to divide by zero rather than answering', () => {
      expect(() => parse('1').dividedBy(Decimal.ZERO, { scale: 2, rounding: 'half-even' }))
        .toThrow(DivisionByZeroError);
    });

    it('rounds ties to even, which is what stops a long ledger drifting upward', () => {
      const half = (text: string): string =>
        parse(text).round(0, 'half-even').toString();

      expect(half('0.5')).toBe('0');
      expect(half('1.5')).toBe('2');
      expect(half('2.5')).toBe('2');
      expect(half('3.5')).toBe('4');
    });

    it.each([
      ['half-up', '2.5', '3'],
      ['half-up', '-2.5', '-3'],
      ['half-down', '2.5', '2'],
      ['half-down', '-2.5', '-2'],
      ['down', '2.9', '2'],
      ['down', '-2.9', '-2'],
      ['up', '2.1', '3'],
      ['up', '-2.1', '-3'],
      ['floor', '2.9', '2'],
      ['floor', '-2.1', '-3'],
      ['ceiling', '2.1', '3'],
      ['ceiling', '-2.9', '-2'],
    ] as const)('rounds %s: %s becomes %s', (mode, input, expected) => {
      expect(parse(input).round(0, mode).toString()).toBe(expected);
    });

    it('widens exactly and refuses to narrow without a rule', () => {
      expect(parse('1.5').rescale(4).toString()).toBe('1.5000');
      expect(() => parse('1.555').rescale(2)).toThrow(RangeError);
    });

    it('divides to the scale it was given, and no further', () => {
      const third = parse('1').dividedBy(parse('3'), { scale: 6, rounding: 'half-even' });

      expect(third.toString()).toBe('0.333333');
    });
  });

  describe('text, which is the only form a value crosses a boundary in', () => {
    it.each(['0', '0.00', '-1.5', '48000.10', '999999999999.99'])(
      'round-trips %s unchanged, at the same scale',
      (text) => {
        expect(parse(text).toString()).toBe(text);
      },
    );

    it('compares by value and not by how it was written', () => {
      expect(parse('1.50').equals(parse('1.5'))).toBe(true);
      expect(parse('1.50').scale).toBe(2);
      expect(parse('1.5').scale).toBe(1);
    });

    it.each(['', ' ', 'abc', '1e5', '1.2.3', '--1', '1.', '.5', '0x10'])(
      'refuses %p rather than guessing at it',
      (text) => {
        expect(() => parse(text)).toThrow(DecimalFormatError);
        expect(Decimal.tryParse(text)).toBeUndefined();
      },
    );

    it('refuses a number long enough to be an attack rather than a value', () => {
      // Caller-supplied text reaches this, and bigint will happily multiply a million-digit
      // number for as long as it takes.
      expect(() => parse('9'.repeat(MAX_DECIMAL_DIGITS + 1))).toThrow(DecimalFormatError);
      expect(parse('9'.repeat(MAX_DECIMAL_DIGITS)).toString()).toHaveLength(
        MAX_DECIMAL_DIGITS,
      );
    });

    it('refuses a float, because by the time one arrives the precision is already gone', () => {
      // @ts-expect-error a number is not text
      expect(() => parse(0.1)).toThrow(DecimalFormatError);
      expect(() => Decimal.fromInteger(0.5)).toThrow(DecimalFormatError);
      expect(Decimal.fromInteger(365).toString()).toBe('365');
    });
  });

  describe('money, which is a number and the currency it is in', () => {
    it('refuses arithmetic across two currencies rather than answering wrongly', () => {
      const pounds = Money.parse('100.00', 'GBP');
      const dollars = Money.parse('100.00', 'USD');

      expect(() => pounds.plus(dollars)).toThrow(CurrencyMismatchError);
      expect(() => pounds.minus(dollars)).toThrow(CurrencyMismatchError);
      expect(() => pounds.compare(dollars)).toThrow(CurrencyMismatchError);
    });

    it('is not equal to the same amount in another currency, not even at zero', () => {
      expect(Money.zero('GBP').equals(Money.zero('USD'))).toBe(false);
      expect(Money.zero('GBP').equals(Money.zero('GBP'))).toBe(true);
    });

    it('pads to the currency scale on the wire so a screen never sees a bare 5', () => {
      expect(Money.parse('5').toValue()).toEqual({
        amount: '5.00',
        currency: DEFAULT_CURRENCY,
      });
    });

    it('keeps every digit of an intermediate and rounds once, at the end', () => {
      const salary = Money.parse('48000.10');
      const days = Decimal.fromInteger(31);
      const year = Decimal.fromInteger(365);

      // Multiplied exactly, divided once, rounded at that division and nowhere else.
      const roundedOnce = salary.times(days).dividedBy(year, {
        scale: 2,
        rounding: 'half-even',
      });

      // The same calculation with the daily rate rounded to the penny first — which is the
      // shape a careless implementation falls into, and is ten pence out on one employee for
      // one month. Multiplied across a workforce and a year, that is the drift the rule about
      // explicit rounding points exists to prevent.
      const roundedEachStep = salary
        .dividedBy(year, { scale: 2, rounding: 'half-even' })
        .times(days)
        .round('half-even');

      expect(roundedOnce.toValue().amount).toBe('4076.72');
      expect(roundedEachStep.toValue().amount).toBe('4076.81');
    });

    it('survives a column the platform withheld, which the type says cannot happen', () => {
      // A restricted field is genuinely absent from the row the tenancy extension returns,
      // while Prisma's generated type still says the column is there. See docs/tenancy.md.
      expect(Money.wire(undefined)).toBeNull();
      expect(Money.wire(null)).toBeNull();
      expect(Money.wire('48000.1')).toEqual({
        amount: '48000.10',
        currency: DEFAULT_CURRENCY,
      });
    });
  });

  describe('quantity, which is fractional and carries no unit', () => {
    it('holds a fraction of a unit of measure exactly', () => {
      expect(Quantity.parse('2.5').plus(Quantity.parse('0.75')).toValue()).toBe('3.25');
    });

    it('does not pad, because trailing zeros are a currency convention', () => {
      expect(Quantity.fromInteger(3).toValue()).toBe('3');
      expect(Quantity.parse('3.000').toValue()).toBe('3.000');
    });

    it('goes negative without complaint, because an issue of stock is a negative movement', () => {
      expect(Quantity.parse('1').minus(Quantity.parse('4')).toValue()).toBe('-3');
      expect(Quantity.parse('1').minus(Quantity.parse('4')).isNegative()).toBe(true);
    });

    it('drops the zeros a division left behind, and only those', () => {
      // Dividing takes the scale it was told to round to whether or not the answer needed it,
      // which is how converting 2.5 kilograms to grams produces six decimal places on a whole
      // number. They are an artifact of the arithmetic rather than precision anybody has.
      const grams = Quantity.parse('2.5')
        .times(Decimal.parse('1000'))
        .dividedBy(Decimal.ONE, { scale: 6, rounding: 'half-even' });

      expect(grams.toValue()).toBe('2500.000000');
      expect(grams.trimmed().toValue()).toBe('2500');

      // Nothing that carries information goes, and a value that needs its places keeps them.
      expect(Quantity.parse('0.250000').trimmed().toValue()).toBe('0.25');
      expect(Quantity.parse('1.005').trimmed().toValue()).toBe('1.005');
      expect(Quantity.parse('0.000000').trimmed().toValue()).toBe('0');
    });
  });
});
