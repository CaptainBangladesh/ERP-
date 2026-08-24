import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY (or an `ant auth login` profile) from env

const prompt = process.argv.slice(2).join(' ') || 'Say hello in one sentence.';

const response = await client.messages.create({
  model: 'claude-opus-5',
  max_tokens: 16000, // safety ceiling — not a length/cost dial
  output_config: { effort: 'high' }, // the actual quality/cost lever: low | medium | high | xhigh | max
  messages: [{ role: 'user', content: prompt }],
});

const text = response.content.find((block) => block.type === 'text')?.text ?? '';

process.stdout.write(`${text}\n`);
process.stderr.write(
  `\n[usage] input=${response.usage.input_tokens} output=${response.usage.output_tokens} stop_reason=${response.stop_reason}\n`,
);
