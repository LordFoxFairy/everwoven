export type DemoIntentReceipt = {inputId: string; state: 'recorded-demo'; videoChanged: false};
/** Frontend demonstration only; this is deliberately not a model Provider. */
export async function recordDemoIntent({inputId, text}: {inputId: string; text: string}): Promise<DemoIntentReceipt> {
  if (!text.trim()) throw Error('请输入内容');
  return {inputId, state: 'recorded-demo', videoChanged: false};
}
