const str = "foo</style>bar";
const codiconCss = ".my-class { content: '$&'; }";
console.log(str.replace('</style>', `  ${codiconCss}</style>`));
console.log(str.replace('</style>', () => `  ${codiconCss}</style>`));
