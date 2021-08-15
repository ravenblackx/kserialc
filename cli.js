#!/usr/bin/env node

if (process.argv.indexOf('-v')!=-1 || process.argv.indexOf('--version')!=-1) {
  const pjson = require('./package.json');
  console.log(pjson.version);
  return;
}

const fs = require('fs');

const src = fs.readFileSync(0, 'utf-8').replace(/\/\/[^\n]*/g, '');

let pos = 0;
const nextCmdRE = /[\s;]*([a-zA-Z0-9_]+)/;
const enumRE = /\s*([a-zA-Z0-9_]+)\s*:\s*(byte|u?int16|u?int32)\s*\{([^\}]+)\}/;
const tableRE = /\s*([a-zA-Z0-9_]+)\s*:\s*([a-zA-Z0-9_]{4})\s*\{([^\}]*)\}/;

const enumTypes = {};
const tableTypes = {};
const enumValues = {};
const commonTypeSizes = {'byte':1, 'uint16':2, 'uint32':4, 'int16': 2, 'int32': 4, 'string':4, 'any':4};
const commonTypeMappings = {'byte':'number', 'uint16':'number', 'uint32':'number','int16':'number','int32':'number','any':'KSerializableAny|null','string':'string','bool':'boolean'};
const commonTypeDefaults = {'byte':'0', 'uint16': '0', 'uint32': '0', 'int16': '0', 'int32': '0', 'string': "''", 'bool': 'false'};

function cap(s) {
 return s.charAt(0).toUpperCase()+s.substring(1);
}

function localTypeTransform(t) {
 if (commonTypeMappings[t]) return commonTypeMappings[t];
 if (enumTypes[t]) return t;
 if (t.endsWith('[]')) return t;
 return `${t}|null`;
}

function transformDefault(t) {
 if (commonTypeDefaults[t]) return commonTypeDefaults[t];
 if (enumTypes[t]) return `${t}.${enumValues[t][0]}`;
 if (t.endsWith('[]')) return '[]';
 return 'null';
}

function typeLength(t) {
 if (commonTypeSizes[t]) return commonTypeSizes[t];
 if (enumTypes[t]) return commonTypeSizes[enumTypes[t]];
 if (tableTypes[t]) return 4;
 if (t.endsWith('[]') && tableTypes[t.substr(0, t.length-2)]) return 4;
 throw(`unrecognized type ${t} - types must be declared before they are used`);
}

function serializeLengthFor(type,name) {
 if (type=='string') return `stringLength(this.${name})`;
 if (type=='any') return `anyLength(this.${name})`;
 if (commonTypeSizes[type]) return null;
 if (enumTypes[type]) return null;
 if (type.endsWith('[]')) return `subArrayLength(this.${name})`;
 return `subLength(this.${name})`;
}

function serializeFor(type,name,offset) {
 if (enumTypes[type]) type = enumTypes[type];
 if (type=='string') return `offset += serializeString(dest, ${offset}, offset, this.${name});`;
 if (type=='any') return `offset += serializeAny(dest, ${offset}, offset, this.${name});`;
 if (commonTypeSizes[type]) return `serialize${cap(type)}(dest, ${offset}, this.${name});`;
 if (type.endsWith('[]')) return `offset += serializeSubArray(dest, ${offset}, offset, this.${name});`;
 return `offset += serializeSub(dest, ${offset}, offset, this.${name});`;
}

function deserializeFor(type,name,offset) {
 if (enumTypes[type]) return `${name}: deserialize${cap(enumTypes[type])}(src, ${offset}) as ${type}`;
 if (commonTypeSizes[type]) return `${name}: deserialize${cap(type)}(src, ${offset})`;
 if (type.endsWith('[]')) return `${name}: deserializeSubArray(${type.substring(0, type.length - 2)}.deserialize, src, ${offset}) as ${type}`;
 return `${name}: deserializeSub(${type}.deserialize, src, ${offset}) as ${type}`;
}

function serializeBoolGroup(bools,offset) {
 const entries = bools.map((e, i) => `((this.${e}?1:0)${i==0?'':`<<${i}`})`);
 return `serializeByte(dest, ${offset}, ${entries.join('+')});`;
}

console.log(`import {KSerializableAny,KSerializable,register,
subLength,anyLength,subArrayLength,stringLength,
serializeSub,serializeSubArray,serializeInt32,serializeInt16,serializeUint32,serializeUint16,serializeByte,serializeString,serializeAny,
deserializeSub,deserializeSubArray,deserializeInt32,deserializeInt16,deserializeUint32,deserializeUint16,deserializeByte,deserializeString,deserializeAny
} from 'kserial';\n`);

for (let match; pos != -1 && (match = src.substr(pos).match(nextCmdRE)) !== null;) {
 pos += match[0].length;
 switch (match[1]) {
  case 'namespace': pos = src.indexOf(';', pos); break;
  case 'enum': {
   const enumMatch = src.substr(pos).match(enumRE);
   if (enumMatch == null) throw(`failed to match enum <name> : <byte|uint16|uint32|int16|int32> {values} at ${src.substr(pos, 80)}`);
   const name = enumMatch[1];
   const type = enumMatch[2];
   const values = enumMatch[3].split(',').map((v) => v.trim()).filter((v) => v.length > 0);
   enumTypes[name]=type;
   enumValues[name]=values;
   console.log(`export enum ${name} {`);
   for (const value of values) {
    if (!value.match(/^[A-Za-z0-9_]+$/)) {
     throw(`invalid enum name: $value`);
    }
    console.log(`  ${value},`);
   }
   console.log('}\n');
   pos += enumMatch[0].length;
   break;
  }
  case 'table': {
   const tableMatch = src.substr(pos).match(tableRE);
   if (tableMatch === null) throw(`failed to match table <name>:<id> {<values>} at ${src.substr(pos, 80)}`);
   const name = tableMatch[1];
   const id = tableMatch[2];
   const values = tableMatch[3].split(';');
   tableTypes[name]=true;
   pos += tableMatch[0].length;
   console.log(`export class ${name} {`);
   console.log(`  static readonly id:string = '${id}';`);
   const names=[];
   const namesWithDefaults=[];
   const types=[];
   const localTypes=[];
   const namesWithTypes=[];
   for (const value of values) {
    if (value.trim().length === 0) continue;
    const nameTypeMatch = value.match(/^\s*([a-zA-Z0-9_]+)\s*:\s*\[?([a-zA-Z0-9_]+)(\]?)$/);
    if (nameTypeMatch === null) throw(`failed to match '<name> : <type>' in values of table ${name}: '${value}'`);
    names.push(nameTypeMatch[1]);
    types.push(nameTypeMatch[2]+(nameTypeMatch[3]?'[]':''));
    localTypes.push(localTypeTransform(types[types.length-1]));
    namesWithDefaults.push(`${nameTypeMatch[1]}=${transformDefault(types[types.length-1])}`);
    namesWithTypes.push(`${nameTypeMatch[1]}?:${localTypes[localTypes.length-1]}`);
    console.log(`  ${nameTypeMatch[1]}: ${localTypes[localTypes.length-1]};`);
   }
   if (namesWithDefaults.length > 0) {
     console.log(`  constructor({${namesWithDefaults.join(',')}}:{${namesWithTypes.join(',')}}={}) {${names.map((n) => `this.${n}=${n};`).join(' ')}}`);
   }
   let baseLength = 0;
   const serializes = [];
   const deserializes = [];
   const bools = [];
   const serializeExtraLengths = [0];
   let o = 0;
   for (let i = 0; i < types.length; i++) {
    if (types[i] == 'bool') {
     if (bools.length == 0 || bools[bools.length-1].length==8) {
      bools.push([]);
     }
     const sub = bools[bools.length-1];
     sub.push(names[i]);
     continue;
    }
    serializes.push(serializeFor(types[i], names[i], baseLength));
    deserializes.push(deserializeFor(types[i], names[i], baseLength));
    baseLength += typeLength(types[i]);
    const fn = serializeLengthFor(types[i], names[i]);
    if (fn === null) continue;
    serializeExtraLengths.push(fn);
   }
   if (bools.length > 0) {
    baseLength += bools.length;
   }
   serializeExtraLengths[0] = baseLength;
   console.log(`  get serializeLength(): number { return ${serializeExtraLengths.join('+')}; }`);
   console.log('  serialize(dest: Uint8Array): number {');
   if (serializes.some((s) => s.includes('offset +='))) {
    console.log(`    let offset = ${baseLength};`);
   }
   for (const serialize of serializes) {
    console.log(`    ${serialize}`);
   }
   for (let i = 0; i < bools.length; i++) {
    console.log(`    ${serializeBoolGroup(bools[i], baseLength-i-1)}`);
   }
   if (serializes.some((s) => s.includes('offset +='))) {
    console.log(`    return offset;`);
   } else {
    console.log(`    return ${baseLength};`);
   }
   console.log('  }');
   
   console.log(`  static deserialize(src: Uint8Array): ${name} {`);
   if (bools.length > 0) {
     for (let i = 0; i < bools.length; i++) {
       const boolGroup = bools[i];
       if (boolGroup.length > 1) {
         console.log(`    const bools${i} = deserializeByte(src, ${baseLength-i-1});`);
         for (let j = 0; j < boolGroup.length; j++) {
           deserializes.push(`${boolGroup[j]}: !!((bools${i}>>${j})&1)`);
         }
       } else {
         deserializes.push(`${boolGroup[0]}: !!deserializeByte(src, ${baseLength-i-1})`);
       }
     }
   }
   if (deserializes.length > 0) {
     console.log(`    return new ${name}({`);
     for (const deserialize of deserializes) {
       console.log(`      ${deserialize},`);
     }
     console.log('    });');
   } else {
     console.log(`    return new ${name}();`);
   }
   console.log('  }');
   console.log('}');
   console.log(`register('${id}', ${name}.deserialize);\n`);
   break;
  }
 }
}
