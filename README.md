# kserialc

This is a lightweight script to generate serializable classes from a schema.

`kserial` is the companion project that allows the generated classes to
serialize and deserialize.

## Installation

```
npm install -g kserialc
```

## Usage

```
kserialc < my_message_types.k > my_message_types.ts
```

## k schema format

The schema is similar to the flatbuffers schema.

### enum

Generates an enum type that can be used in the serializable messages.

The `<byte|uint16|uint32>` value determines the representation of the 
enum in the serialized data.

```
enum <name> : <byte|uint16|uint32> {
  VALUE1,
  VALUE2,
  [...]
}
```

### table

Generates a serializable class named `<name>`. The four character ID must
be unique across all messages within the same project - it is used to
parse messages received in an `any` type.

```
table <name> : <four character id> {
  <field1name>: <field1type>;
  <field2name>: <field2type>;
  [...]
}
```

#### Possible field types

`uint16`, `uint32`, `int16`, `int32`, `byte`

The basic types, each taking up the obvious fixed number of bytes. They all map to `number` in typescript.

`string`

The other basic type. Takes up 4 bytes in the base table even if the string
is empty, plus 4 bytes in the dynamic area for the length if nonzero,
plus however many bytes it takes to represent the string in utf8.

`bool`

A mostly basic type. Every 8 or subset of 8 bools in a message take up 1
byte in the base table. Maps to `boolean` in typescript.

`your_enum_type`

Takes up the number of bytes in the base table as selected for the enum type.

`your_table_type`

A single submessage.

Takes up 4 bytes in the base table even if null, plus 4 bytes in the dynamic
area for the length if nonzero, plus however many bytes the submessage
serializes to.

`[your_table_type]`

An array of the same type of submessage.

Takes up 4 bytes in the base table even if empty, plus 4 bytes in the dynamic
area for the length of the array, plus 4 bytes for each message for its
offset, plus 4 bytes for the offset to the end of the last message, plus
the combined size of the submessages.

`any`

A single submessage dynamically typed.

Takes up 4 bytes in the base table even if null, plus 4 bytes in the dynamic
area for the length if nonzero, plus 4 bytes for the id, plus however many
bytes the submessage serializes to.


### Example schema

```
enum TestEnum : byte { X, Y, SOMETHING, Z };

table TestMsg : test {
  name: string;
  age: byte;
  something: TestEnum;
  whatever: int32;
  herp: uint32;
  derp: int16;
  glurp: uint16;
  pleaseDontRecurse: TestMsg;
  dontRecurseHereEither: [TestMsg];
  norInAnAny: any;
}

table TestMsgJustStr : tstr {
  str: string;
}

table TestMsgNoFlex : tnof {
  byte: byte;
  byteEnum: TestEnum;
  int32: int32;
  uint32: uint32;
  int16: int16;
  uint16: uint16;
}
```

Note, it is possible to create a recursive message as a message value
can be populated with itself, in the simplest case. If you do this, you
will create a stack overflow.

However, it is *not* possible to send a recursive message in the form of
the serialized binary, because each message may only refer to its own
contents - any offset that attempts to point outside of the message will
cause an exception to be thrown during deserialize.
