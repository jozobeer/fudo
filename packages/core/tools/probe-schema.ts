import { Schema } from 'effect'

const Parameters = Schema.Struct({
  path: Schema.String.annotate({ description: 'value description' }).annotateKey({
    description: 'key description',
  }),
  offset: Schema.optionalKey(Schema.Int.annotate({ description: 'offset value' })),
})
console.log(JSON.stringify(Schema.toJsonSchemaDocument(Parameters), null, 2))
