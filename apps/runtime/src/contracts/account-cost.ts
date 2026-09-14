import {fields} from './story-draft-validation.js';
export type AccountCost={currency:'USD'|'CNY';amount:string};
/** The original decimal is retained; conversion rounds upward at the account micro-unit boundary. */
export function costMicros(amount:string,unitMicros=1000000n):bigint{
 if(typeof amount!=='string'||amount.length>64)throw Error('INVALID_COST_EVIDENCE');
 const parts=/^(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:e([+-]?[0-9]{1,3}))?$/.exec(amount);
 if(!parts)throw Error('INVALID_COST_EVIDENCE');
 const fraction=parts[2]??'',exponent=Number(parts[3]??0)-fraction.length;
 if(Math.abs(exponent)>100)throw Error('INVALID_COST_EVIDENCE');
 let numerator=BigInt(parts[1]+fraction)*unitMicros,denominator=1n;
 if(exponent>=0)numerator*=10n**BigInt(exponent);else denominator=10n**BigInt(-exponent);
 const value=(numerator+denominator-1n)/denominator;
 if(value>9223372036854775807n)throw Error('INVALID_COST_EVIDENCE');return value;
}
export function parseAccountCost(v:unknown):AccountCost{
 fields(v,['currency','amount']);if(v.currency!=='USD'&&v.currency!=='CNY')throw Error('INVALID_COST_EVIDENCE');
 costMicros(v.amount as string);return{currency:v.currency,amount:v.amount as string};
}
