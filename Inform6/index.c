/* ------------------------------------------------------------------------- */
/*   "index" :  JSON symbol index output for language server use             */
/*                                                                           */
/*   Addition to Inform 6.45 for language server support                     */
/*                                                                           */
/* ------------------------------------------------------------------------- */

#include "header.h"

/* ------------------------------------------------------------------------- */
/*   Routine info: captured during parsing so we can record local variables  */
/*   (which are not stored in the symbol table).                             */
/* ------------------------------------------------------------------------- */

#define MAX_INDEX_ROUTINES 4096
#define MAX_INDEX_LOCALS_TOTAL 65536

typedef struct index_routine_s {
    char *name;
    int r_symbol;             /* symbol table index, or -1 */
    int embedded;             /* TRUE if embedded in object property */
    brief_location line;      /* source location */
    int32 end_line;           /* line number of closing ] */
    int locals_start;         /* index into locals_pool */
    int locals_count;
    char *doc;                /* doc comment, or NULL */
} index_routine;

static index_routine *routines_info;
static int routines_count;

static char **locals_pool;
static int locals_pool_count;

static memory_list routines_info_memlist;
static memory_list locals_pool_memlist;

/* --------------------------------------------------------------------- */
/*   Object info: captured during parsing for the objects[] JSON section  */
/* --------------------------------------------------------------------- */

#define MAX_INDEX_OBJECTS 2048
#define MAX_INDEX_OBJ_ATTRS 4096
#define MAX_INDEX_OBJ_PROPS 4096

typedef struct index_object_s {
    char *name;
    char *shortname;           /* quoted string name, or NULL if absent */
    int symbol;                /* symbol table index, or 0 */
    int is_class;              /* TRUE if defined via Class directive */
    int parent;                /* parent object number (0 = none) */
    brief_location line;       /* source location */
    int32 end_line;            /* line number of closing ; */
    int attrs_start;           /* index into obj_attrs_pool */
    int attrs_count;
    int props_start;           /* index into obj_props_pool */
    int props_count;
    int private_props_start;   /* index into obj_private_props_pool */
    int private_props_count;
    char *doc;                 /* doc comment, or NULL */
} index_object;

static index_object *objects_info;
static int objects_info_count;

/* Property/attribute entry: name + line where it appears in the object body */
typedef struct index_prop_entry_s {
    char *name;
    int32 line;
} index_prop_entry;

static index_prop_entry *obj_attrs_pool;   /* attribute entries */
static int obj_attrs_pool_count;

static index_prop_entry *obj_props_pool;   /* property entries (public) */
static int obj_props_pool_count;

static index_prop_entry *obj_private_props_pool;   /* property entries (private) */
static int obj_private_props_pool_count;

static memory_list objects_info_memlist;
static memory_list obj_attrs_pool_memlist;
static memory_list obj_props_pool_memlist;
static memory_list obj_private_props_pool_memlist;

/* ------------------------------------------------------------------------- */
/*   String copy helper                                                      */
/* ------------------------------------------------------------------------- */

static char *index_strdup(const char *s)
{   int len = strlen(s);
    char *copy = malloc(len + 1);
    if (!copy) fatalerror("out of memory in index");
    memcpy(copy, s, len + 1);
    return copy;
}

/* --------------------------------------------------------------------- */
/*   Symbol reference positions                                          */
/*                                                                       */
/*   Each entry records a use-site: which symbol was referenced and      */
/*   its exact source location. System-file references are excluded.    */
/* --------------------------------------------------------------------- */

typedef struct index_sym_ref_s {
    int32 symbol_index;   /* index into symbols[] */
    int32 file_index;     /* 1-based into InputFiles[] */
    int32 line;
    int32 col;            /* 0-based column */
} index_sym_ref;

static index_sym_ref *sym_refs;
static int sym_refs_count;
static memory_list sym_refs_memlist;

static int compare_sym_refs(const void *a, const void *b)
{   const index_sym_ref *ra = (const index_sym_ref *)a;
    const index_sym_ref *rb = (const index_sym_ref *)b;
    if (ra->symbol_index != rb->symbol_index)
        return (ra->symbol_index < rb->symbol_index) ? -1 : 1;
    if (ra->file_index != rb->file_index)
        return (ra->file_index < rb->file_index) ? -1 : 1;
    if (ra->line != rb->line)
        return (ra->line < rb->line) ? -1 : 1;
    return (ra->col < rb->col) ? -1 : (ra->col > rb->col) ? 1 : 0;
}

extern void index_note_symbol_ref(int symindex)
{   debug_location loc;
    index_sym_ref *r;
    if (symindex < 0) return;
    if (is_systemfile()) return;
    loc = get_last_token_start_location();
    if (loc.file_index <= 0) return;
    ensure_memory_list_available(&sym_refs_memlist, sym_refs_count + 1);
    r = &sym_refs[sym_refs_count++];
    r->symbol_index = symindex;
    r->file_index = loc.file_index;
    r->line = loc.beginning_line_number;
    r->col = loc.beginning_character_number - 1;
}

extern void index_note_action_sym_ref(const char *name)
{   char action_sym[256];
    int symindex, len;
    debug_location loc;
    index_sym_ref *r;
    if (is_systemfile()) return;
    len = strlen(name);
    if (len + 4 > (int)sizeof(action_sym)) return;
    memcpy(action_sym, name, len);
    memcpy(action_sym + len, "__A", 4);   /* includes null terminator */
    symindex = get_symbol_index(action_sym);
    if (symindex < 0) return;
    loc = get_last_token_start_location();
    if (loc.file_index <= 0) return;
    ensure_memory_list_available(&sym_refs_memlist, sym_refs_count + 1);
    r = &sym_refs[sym_refs_count++];
    r->symbol_index = symindex;
    r->file_index = loc.file_index;
    r->line = loc.beginning_line_number;
    r->col = loc.beginning_character_number - 1;
}

/* --------------------------------------------------------------------- */
/*   Include-directive capture                                           */
/* --------------------------------------------------------------------- */

typedef struct index_include_s {
    char *from_file;     /* absolute path of the including file */
    int32 from_line;     /* 1-based line of the Include string literal */
    int32 from_col;      /* 0-based column of the opening " */
    char *given;         /* raw argument string (e.g. "parser" or ">local") */
    char *resolved;      /* absolute path of the included file */
    int   file_index;    /* 0-based index into files[] */
} index_include;

static index_include *includes_info;
static int includes_count;
static memory_list includes_memlist;

extern void index_note_include(const char *given, debug_location str_loc)
{   index_include *inc;
    ensure_memory_list_available(&includes_memlist, includes_count + 1);
    inc = &includes_info[includes_count];
    inc->from_file  = index_strdup(InputFiles[str_loc.file_index - 1].filename);
    inc->from_line  = str_loc.beginning_line_number;
    inc->from_col   = str_loc.beginning_character_number - 1;
    inc->given      = index_strdup(given);
    inc->file_index = total_input_files - 1;   /* 0-based, matches files[] */
    inc->resolved   = index_strdup(InputFiles[total_input_files - 1].filename);
    includes_count++;
}

/* --------------------------------------------------------------------- */
/*   Conditional compilation tracking                                    */
/*                                                                       */
/*   Each #IfDef/#IfNDef/#IfV3/#IfV5/#IfTrue/#IfFalse...#Endif block     */
/*   produces one entry (including blocks nested inside non-active       */
/*   branches: those are marked with active="none" since the compiler   */
/*   doesn't evaluate the inner condition while skipping).               */
/* --------------------------------------------------------------------- */

#define MAX_INDEX_COND_DEPTH 32

typedef struct index_conditional_s {
    int   directive;             /* IFDEF_CODE, IFNDEF_CODE, ... */
    int32 file_index;            /* 1-based into InputFiles[] */
    int32 start_line;
    int32 start_col;             /* 0-based column of '#' */
    int32 else_line;             /* 0 if no #Ifnot */
    int32 else_col;
    int32 end_line;              /* 0 if never closed (e.g. EOF in skip) */
    int32 end_col;
    int   dead;                  /* TRUE if nested in inactive parent */
    int   taken;                 /* meaningful only when !dead */
} index_conditional;

static index_conditional *conditionals;
static int conditionals_count;
static memory_list conditionals_memlist;

/* Open conditionals: stack of indexes into conditionals[]. */
static int cond_stack[MAX_INDEX_COND_DEPTH];
static int cond_sp;

extern void index_begin_conditional(int directive, int dead, int taken,
    debug_location loc)
{   index_conditional *c;
    if (cond_sp >= MAX_INDEX_COND_DEPTH) return;
    ensure_memory_list_available(&conditionals_memlist,
        conditionals_count + 1);
    c = &conditionals[conditionals_count];
    c->directive  = directive;
    c->file_index = loc.file_index;
    c->start_line = loc.beginning_line_number;
    c->start_col  = loc.beginning_character_number - 1;
    c->else_line = 0; c->else_col = 0;
    c->end_line  = 0; c->end_col  = 0;
    c->dead  = dead ? 1 : 0;
    c->taken = (!dead && taken) ? 1 : 0;
    cond_stack[cond_sp++] = conditionals_count;
    conditionals_count++;
}

extern void index_note_conditional_else(debug_location loc)
{   index_conditional *c;
    if (cond_sp <= 0) return;
    c = &conditionals[cond_stack[cond_sp - 1]];
    if (c->else_line != 0) return;     /* first #Ifnot wins */
    c->else_line = loc.beginning_line_number;
    c->else_col  = loc.beginning_character_number - 1;
}

extern void index_end_conditional(debug_location loc)
{   index_conditional *c;
    if (cond_sp <= 0) return;
    c = &conditionals[cond_stack[--cond_sp]];
    c->end_line = loc.beginning_line_number;
    c->end_col  = loc.beginning_character_number - 1;
}

static const char *cond_directive_name(int code)
{   switch (code)
    {   case IFDEF_CODE:   return "ifdef";
        case IFNDEF_CODE:  return "ifndef";
        case IFV3_CODE:    return "ifv3";
        case IFV5_CODE:    return "ifv5";
        case IFTRUE_CODE:  return "iftrue";
        case IFFALSE_CODE: return "iffalse";
        default:           return "unknown";
    }
}

/* --------------------------------------------------------------------- */
/*   Error/warning capture for JSON output                               */
/* --------------------------------------------------------------------- */

#define MAX_INDEX_ERRORS 256

typedef struct index_error_s {
    char *file;
    int32 line;
    char *message;
    int severity;           /* 1=error, 2=warning, 3=linker error, 4=fatal */
} index_error;

static index_error *errors_info;
static int errors_info_count;
static memory_list errors_info_memlist;

extern void index_note_error(const char *file, int32 line,
    const char *msg, int severity)
{   index_error *e;
    ensure_memory_list_available(&errors_info_memlist,
        errors_info_count + 1);
    e = &errors_info[errors_info_count];
    e->file = file ? index_strdup(file) : NULL;
    e->line = line;
    e->message = index_strdup(msg);
    e->severity = severity;
    errors_info_count++;
}

/* --------------------------------------------------------------------- */
/*   Doc comment buffers                                                 */
/*                                                                       */
/*   Preceding doc: !! lines on their own line, before a definition.     */
/*   Trailing doc: !! after code on the same line as a definition.       */
/* --------------------------------------------------------------------- */

#define MAX_DOC_BUFFER 4096

static char *doc_buffer;          /* preceding doc comment text */
static int doc_buffer_len;
static int doc_fresh;             /* TRUE if no real tokens since last !! */

static char *trailing_doc_text;   /* trailing doc comment text */
static int32 trailing_doc_line;   /* line number of the trailing doc */
static int trailing_doc_file;     /* file index of the trailing doc */

/* List of all trailing doc comments for lookup at output time */
#define MAX_TRAILING_DOCS 256
typedef struct trailing_doc_s {
    char *text;
    int32 line;
    int file_index;
} trailing_doc_entry;
static trailing_doc_entry *trailing_docs;
static int trailing_docs_count;

static memory_list doc_buffer_memlist;
static memory_list trailing_doc_memlist;
static memory_list trailing_docs_list_memlist;

/* Parallel array for symbol doc comments, indexed by symbol number */
#define MAX_SYMBOL_DOCS 4096
static char **symbol_docs;
static memory_list symbol_docs_memlist;

/* Parallel array marking which property symbols were formally declared via
   the `Property` directive (vs. created implicitly by inline use in an
   object's `with` block). One byte per symbol: 1 = formal, 0 = implicit. */
static unsigned char *formal_property_marks;
static memory_list formal_property_marks_memlist;

static char *index_consume_doc(int32 def_line);

extern void index_note_property_formal(int symbol)
{   if (symbol < 0) return;
    ensure_memory_list_available(&formal_property_marks_memlist, symbol + 1);
    formal_property_marks[symbol] = 1;
}

extern void index_note_symbol_doc(int symbol)
{   char *doc;
    brief_location loc;
    if (symbol < 0) return;
    loc = get_brief_location(&ErrorReport);
    doc = index_consume_doc(loc.line_number);
    if (!doc) return;
    ensure_memory_list_available(&symbol_docs_memlist, symbol + 1);
    if (symbol_docs[symbol]) free(symbol_docs[symbol]);
    symbol_docs[symbol] = doc;
}

extern void index_doc_comment_line(const char *text)
{   int len;

    if (!doc_fresh && doc_buffer_len > 0)
    {   /* A non-doc token was seen since the last !! line — stale buffer */
        doc_buffer_len = 0;
    }
    doc_fresh = TRUE;

    len = strlen(text);
    /* Skip leading whitespace in the comment text */
    while (len > 0 && (text[0] == ' ' || text[0] == '\t'))
    {   text++; len--;
    }
    /* Trim trailing whitespace */
    while (len > 0 && (text[len-1] == ' ' || text[len-1] == '\t'
           || text[len-1] == '\n' || text[len-1] == '\r'))
        len--;

    if (len == 0) return;

    /* Append to doc buffer (with newline separator if not first line) */
    ensure_memory_list_available(&doc_buffer_memlist,
        doc_buffer_len + len + 2);
    if (doc_buffer_len > 0)
        doc_buffer[doc_buffer_len++] = '\n';
    memcpy(doc_buffer + doc_buffer_len, text, len);
    doc_buffer_len += len;
    doc_buffer[doc_buffer_len] = '\0';
}

extern void index_doc_comment_trailing(const char *text, int32 line)
{   int len = strlen(text);
    /* Skip leading whitespace */
    while (len > 0 && (text[0] == ' ' || text[0] == '\t'))
    {   text++; len--;
    }
    /* Trim trailing whitespace */
    while (len > 0 && (text[len-1] == ' ' || text[len-1] == '\t'
           || text[len-1] == '\n' || text[len-1] == '\r'))
        len--;

    if (len == 0) return;

    ensure_memory_list_available(&trailing_doc_memlist, len + 1);
    memcpy(trailing_doc_text, text, len);
    trailing_doc_text[len] = '\0';
    trailing_doc_line = line;
    {   brief_location loc = get_brief_location(&ErrorReport);
        trailing_doc_file = loc.file_index;
    }

    /* Also store in the persistent list for lookup at output time */
    ensure_memory_list_available(&trailing_docs_list_memlist,
        trailing_docs_count + 1);
    trailing_docs[trailing_docs_count].text = index_strdup(trailing_doc_text);
    trailing_docs[trailing_docs_count].line = line;
    trailing_docs[trailing_docs_count].file_index = trailing_doc_file;
    trailing_docs_count++;
}

extern void index_doc_nontrivial_token(void)
{   doc_fresh = FALSE;
}

/* Look up a trailing doc comment by file and line number */
static const char *find_trailing_doc(int file_index, int32 line)
{   int i;
    for (i = 0; i < trailing_docs_count; i++)
    {   if (trailing_docs[i].line == line
            && trailing_docs[i].file_index == file_index)
            return trailing_docs[i].text;
    }
    return NULL;
}

/* Consume and return the doc comment for a definition.
   Returns a malloc'd string, or NULL if none. Caller must free. */
static char *index_consume_doc(int32 def_line)
{   char *result = NULL;

    /* Check trailing doc first — if it's on the same line, use it */
    if (trailing_doc_text[0] != '\0' && trailing_doc_line == def_line)
    {   result = index_strdup(trailing_doc_text);
        trailing_doc_text[0] = '\0';
        trailing_doc_line = 0;
        doc_buffer_len = 0;
        return result;
    }

    /* Check preceding doc buffer */
    if (doc_buffer_len > 0)
    {   result = index_strdup(doc_buffer);
        doc_buffer_len = 0;
        return result;
    }

    return NULL;
}

/* Pending attribute/property entries for current object being parsed */
static index_prop_entry *pending_attrs;
static int pending_attrs_count;
static memory_list pending_attrs_memlist;

static index_prop_entry *pending_props;
static int pending_props_count;
static memory_list pending_props_memlist;

static index_prop_entry *pending_private_props;
static int pending_private_props_count;
static memory_list pending_private_props_memlist;

/* ------------------------------------------------------------------------- */
/*   JSON output helpers                                                     */
/* ------------------------------------------------------------------------- */

static void json_print_escaped_string(const char *s)
{   const char *p;
    putchar('"');
    for (p = s; *p; p++)
    {   switch (*p)
        {   case '"':  printf("\\\""); break;
            case '\\': printf("\\\\"); break;
            case '\n': printf("\\n"); break;
            case '\r': printf("\\r"); break;
            case '\t': printf("\\t"); break;
            default:
                if ((unsigned char)*p < 0x20)
                    printf("\\u%04x", (unsigned char)*p);
                else
                    putchar(*p);
                break;
        }
    }
    putchar('"');
}

/* Resolve path to absolute before printing. Falls back to the original
   if realpath() fails (e.g. file no longer exists at output time). */
static void json_print_abs_path(const char *path)
{
#ifdef HAS_REALPATH
    char resolved[4096];
    if (path && realpath(path, resolved))
    {   json_print_escaped_string(resolved);
        return;
    }
#endif
    json_print_escaped_string(path ? path : "");
}

static const char *array_type_name(int type)
{   switch (type)
    {   case BYTE_ARRAY:   return "byte";
        case WORD_ARRAY:   return "word";
        case STRING_ARRAY: return "string";
        case TABLE_ARRAY:  return "table";
        case BUFFER_ARRAY: return "buffer";
        default:           return "unknown";
    }
}

static const char *symbol_type_name(int type)
{   switch (type)
    {   case ROUTINE_T:             return "routine";
        case LABEL_T:               return "label";
        case GLOBAL_VARIABLE_T:     return "global_variable";
        case ARRAY_T:               return "array";
        case STATIC_ARRAY_T:        return "static_array";
        case CONSTANT_T:            return "constant";
        case ATTRIBUTE_T:           return "attribute";
        case PROPERTY_T:            return "property";
        case INDIVIDUAL_PROPERTY_T: return "individual_property";
        case OBJECT_T:              return "object";
        case CLASS_T:               return "class";
        case FAKE_ACTION_T:         return "fake_action";
        default:                    return "unknown";
    }
}

/* Emit ", "doc": "..." if a doc comment exists for the given symbol index */
static void json_print_symbol_doc(int sym_index)
{   const char *doc = NULL;
    if (sym_index < (int)symbol_docs_memlist.count && symbol_docs[sym_index]
        && symbol_docs[sym_index][0] != '\0')
        doc = symbol_docs[sym_index];
    if (!doc && symbols[sym_index].line.file_index > 0)
        doc = find_trailing_doc(symbols[sym_index].line.file_index,
            symbols[sym_index].line.line_number);
    if (doc)
    {   printf(", \"doc\": ");
        json_print_escaped_string(doc);
    }
}

/* ------------------------------------------------------------------------- */
/*   Capture routine info during parsing                                     */
/* ------------------------------------------------------------------------- */

extern void index_note_routine(char *name, int embedded_flag, int r_symbol)
{   int i;
    index_routine *r;

    ensure_memory_list_available(&routines_info_memlist, routines_count+1);

    r = &routines_info[routines_count];
    r->name = index_strdup(name);
    r->r_symbol = r_symbol;
    r->embedded = embedded_flag;
    r->line = get_brief_location(&ErrorReport);
    r->locals_start = locals_pool_count;
    r->locals_count = no_locals;
    r->doc = index_consume_doc(r->line.line_number);

    ensure_memory_list_available(&locals_pool_memlist,
        locals_pool_count + no_locals);

    for (i = 0; i < no_locals; i++)
        locals_pool[locals_pool_count + i] =
            index_strdup(get_local_variable_name(i));

    locals_pool_count += no_locals;
    routines_count++;
}

extern void index_note_routine_end(void)
{   if (routines_count > 0)
    {   brief_location loc = get_brief_location(&ErrorReport);
        routines_info[routines_count - 1].end_line = loc.line_number;
    }
}

/* ------------------------------------------------------------------------- */
/*   Capture object info during parsing                                      */
/* ------------------------------------------------------------------------- */

static char *pending_object_doc;

extern void index_reset_object_props(void)
{   brief_location loc = get_brief_location(&ErrorReport);
    pending_attrs_count = 0;
    pending_props_count = 0;
    pending_private_props_count = 0;
    if (pending_object_doc) free(pending_object_doc);
    pending_object_doc = index_consume_doc(loc.line_number);
}

extern void index_note_attribute(char *name)
{   index_prop_entry *e;
    brief_location loc;
    report_errors_at_current_line();
    loc = get_brief_location(&ErrorReport);
    ensure_memory_list_available(&pending_attrs_memlist,
        pending_attrs_count + 1);
    e = &pending_attrs[pending_attrs_count++];
    e->name = index_strdup(name);
    e->line = loc.line_number;
}

extern void index_note_property(char *name, int is_private)
{   index_prop_entry *e;
    brief_location loc;
    report_errors_at_current_line();
    loc = get_brief_location(&ErrorReport);
    if (is_private)
    {   ensure_memory_list_available(&pending_private_props_memlist,
            pending_private_props_count + 1);
        e = &pending_private_props[pending_private_props_count++];
    }
    else
    {   ensure_memory_list_available(&pending_props_memlist,
            pending_props_count + 1);
        e = &pending_props[pending_props_count++];
    }
    e->name = index_strdup(name);
    e->line = loc.line_number;
}

extern void index_note_object(char *name, const char *shortname, int symbol,
    int is_class, int parent, brief_location start)
{   int i;
    index_object *o;
    brief_location loc = get_brief_location(&ErrorReport);

    ensure_memory_list_available(&objects_info_memlist,
        objects_info_count + 1);

    o = &objects_info[objects_info_count];
    o->name = index_strdup(name);
    o->shortname = shortname ? index_strdup(shortname) : NULL;
    o->symbol = symbol;
    o->is_class = is_class;
    o->parent = parent;
    o->line = start;
    o->end_line = loc.line_number;
    o->doc = pending_object_doc;
    pending_object_doc = NULL;

    /* Copy pending attributes */
    o->attrs_start = obj_attrs_pool_count;
    o->attrs_count = pending_attrs_count;
    ensure_memory_list_available(&obj_attrs_pool_memlist,
        obj_attrs_pool_count + pending_attrs_count);
    for (i = 0; i < pending_attrs_count; i++)
        obj_attrs_pool[obj_attrs_pool_count + i] = pending_attrs[i];
    obj_attrs_pool_count += pending_attrs_count;

    /* Copy pending properties (public) */
    o->props_start = obj_props_pool_count;
    o->props_count = pending_props_count;
    ensure_memory_list_available(&obj_props_pool_memlist,
        obj_props_pool_count + pending_props_count);
    for (i = 0; i < pending_props_count; i++)
        obj_props_pool[obj_props_pool_count + i] = pending_props[i];
    obj_props_pool_count += pending_props_count;

    /* Copy pending properties (private) */
    o->private_props_start = obj_private_props_pool_count;
    o->private_props_count = pending_private_props_count;
    ensure_memory_list_available(&obj_private_props_pool_memlist,
        obj_private_props_pool_count + pending_private_props_count);
    for (i = 0; i < pending_private_props_count; i++)
        obj_private_props_pool[obj_private_props_pool_count + i] =
            pending_private_props[i];
    obj_private_props_pool_count += pending_private_props_count;

    pending_attrs_count = 0;
    pending_props_count = 0;
    pending_private_props_count = 0;

    objects_info_count++;
}

/* ------------------------------------------------------------------------- */
/*   JSON output                                                             */
/* ------------------------------------------------------------------------- */

extern void index_output_json(void)
{   int i, j, first;
    int is_sys;

    printf("{\n");
    printf("  \"version\": 1,\n");

    /* --- files --- */
    printf("  \"files\": [\n");
    first = TRUE;
    for (i = 0; i < total_input_files; i++)
    {   if (!first) printf(",\n");
        printf("    ");
        json_print_abs_path(InputFiles[i].filename);
        first = FALSE;
    }
    printf("\n  ],\n");

    /* --- symbols --- */
    printf("  \"symbols\": [\n");
    first = TRUE;
    for (i = 0; i < no_symbols; i++)
    {   if (symbols[i].type == LABEL_T) continue;
        if (symbols[i].flags & UNKNOWN_SFLAG) continue;

        if (!first) printf(",\n");
        first = FALSE;

        is_sys = (symbols[i].flags & SYSTEM_SFLAG) ? 1 : 0;

        printf("    {\"name\": ");
        json_print_escaped_string(symbols[i].name);
        printf(", \"type\": \"%s\"", symbol_type_name(symbols[i].type));
        printf(", \"value\": %d", (int)symbols[i].value);
        printf(", \"flags\": %u", symbols[i].flags);
        printf(", \"is_system\": %s", is_sys ? "true" : "false");

        if (symbols[i].type == PROPERTY_T
            || symbols[i].type == INDIVIDUAL_PROPERTY_T)
        {   int formal = (i < (int)formal_property_marks_memlist.count
                && formal_property_marks[i]) ? 1 : 0;
            printf(", \"formal_declaration\": %s",
                formal ? "true" : "false");
        }

        if (symbols[i].line.file_index > 0)
        {   printf(", \"file\": ");
            json_print_abs_path(
                InputFiles[symbols[i].line.file_index - 1].filename);
            printf(", \"line\": %d",
                (int)symbols[i].line.line_number);
        }
        json_print_symbol_doc(i);
        printf("}");
    }
    printf("\n  ],\n");

    /* --- routines --- */
    printf("  \"routines\": [\n");
    first = TRUE;
    for (i = 0; i < routines_count; i++)
    {   index_routine *r = &routines_info[i];

        if (!first) printf(",\n");
        first = FALSE;

        printf("    {\"name\": ");
        json_print_escaped_string(r->name);

        if (r->embedded)
            printf(", \"embedded\": true");

        /* Include source location */
        if (r->line.file_index > 0)
        {   printf(", \"file\": ");
            json_print_abs_path(
                InputFiles[r->line.file_index - 1].filename);
            printf(", \"start_line\": %d",
                (int)r->line.line_number);
            if (r->end_line > 0)
                printf(", \"end_line\": %d", (int)r->end_line);
        }

        if (r->doc)
        {   printf(", \"doc\": ");
            json_print_escaped_string(r->doc);
        }

        printf(", \"locals\": [");
        for (j = 0; j < r->locals_count; j++)
        {   if (j > 0) printf(", ");
            json_print_escaped_string(
                locals_pool[r->locals_start + j]);
        }
        printf("]}");
    }
    printf("\n  ],\n");

    /* --- objects --- */
    printf("  \"objects\": [\n");
    first = TRUE;
    for (i = 0; i < objects_info_count; i++)
    {   index_object *o = &objects_info[i];

        if (!first) printf(",\n");
        first = FALSE;

        printf("    {\"name\": ");
        json_print_escaped_string(o->name);

        if (o->shortname)
        {   printf(", \"shortname\": ");
            json_print_escaped_string(o->shortname);
        }

        if (o->is_class)
            printf(", \"is_class\": true");

        if (o->line.file_index > 0)
        {   printf(", \"file\": ");
            json_print_abs_path(
                InputFiles[o->line.file_index - 1].filename);
            printf(", \"start_line\": %d",
                (int)o->line.line_number);
            if (o->end_line > 0)
                printf(", \"end_line\": %d", (int)o->end_line);
        }

        if (o->parent > 0)
        {   /* Find the parent's name from the symbol table */
            int found = FALSE;
            for (j = 0; j < no_symbols; j++)
            {   if ((symbols[j].type == OBJECT_T
                     || symbols[j].type == CLASS_T)
                    && symbols[j].value == o->parent)
                {   printf(", \"parent\": ");
                    json_print_escaped_string(symbols[j].name);
                    found = TRUE;
                    break;
                }
            }
            if (!found)
                printf(", \"parent_id\": %d", o->parent);
        }

        printf(", \"attributes\": [");
        for (j = 0; j < o->attrs_count; j++)
        {   index_prop_entry *a = &obj_attrs_pool[o->attrs_start + j];
            if (j > 0) printf(", ");
            printf("{\"name\": ");
            json_print_escaped_string(a->name);
            printf(", \"line\": %d}", (int)a->line);
        }
        printf("]");

        if (o->doc)
        {   printf(", \"doc\": ");
            json_print_escaped_string(o->doc);
        }

        printf(", \"properties\": [");
        for (j = 0; j < o->props_count; j++)
        {   index_prop_entry *p = &obj_props_pool[o->props_start + j];
            if (j > 0) printf(", ");
            printf("{\"name\": ");
            json_print_escaped_string(p->name);
            printf(", \"line\": %d}", (int)p->line);
        }
        printf("]");

        printf(", \"private_properties\": [");
        for (j = 0; j < o->private_props_count; j++)
        {   index_prop_entry *p =
                &obj_private_props_pool[o->private_props_start + j];
            if (j > 0) printf(", ");
            printf("{\"name\": ");
            json_print_escaped_string(p->name);
            printf(", \"line\": %d}", (int)p->line);
        }
        printf("]}");
    }
    printf("\n  ],\n");

    /* --- globals --- */
    printf("  \"globals\": [\n");
    first = TRUE;
    for (i = 0; i < no_symbols; i++)
    {   if (symbols[i].type != GLOBAL_VARIABLE_T) continue;
        if (symbols[i].flags & UNKNOWN_SFLAG) continue;
        if (symbols[i].flags & SYSTEM_SFLAG) continue;

        if (!first) printf(",\n");
        first = FALSE;

        printf("    {\"name\": ");
        json_print_escaped_string(symbols[i].name);

        if (symbols[i].line.file_index > 0)
        {   printf(", \"file\": ");
            json_print_abs_path(
                InputFiles[symbols[i].line.file_index - 1].filename);
            printf(", \"line\": %d",
                (int)symbols[i].line.line_number);
        }
        json_print_symbol_doc(i);
        printf("}");
    }
    printf("\n  ],\n");

    /* --- constants --- */
    printf("  \"constants\": [\n");
    first = TRUE;
    for (i = 0; i < no_symbols; i++)
    {   if (symbols[i].type != CONSTANT_T) continue;
        if (symbols[i].flags & UNKNOWN_SFLAG) continue;
        if (symbols[i].flags & SYSTEM_SFLAG) continue;

        if (!first) printf(",\n");
        first = FALSE;

        printf("    {\"name\": ");
        json_print_escaped_string(symbols[i].name);

        if (symbols[i].line.file_index > 0)
        {   printf(", \"file\": ");
            json_print_abs_path(
                InputFiles[symbols[i].line.file_index - 1].filename);
            printf(", \"line\": %d",
                (int)symbols[i].line.line_number);
        }
        json_print_symbol_doc(i);
        printf("}");
    }
    printf("\n  ],\n");

    /* --- arrays --- */
    printf("  \"arrays\": [\n");
    first = TRUE;
    for (i = 0; i < no_arrays; i++)
    {   int sym = arrays[i].symbol;

        if (symbols[sym].flags & SYSTEM_SFLAG) continue;

        if (!first) printf(",\n");
        first = FALSE;

        printf("    {\"name\": ");
        json_print_escaped_string(symbols[sym].name);
        printf(", \"array_type\": \"%s\"", array_type_name(arrays[i].type));
        printf(", \"size\": %d", arrays[i].size);
        if (arrays[i].loc)
            printf(", \"is_static\": true");

        if (symbols[sym].line.file_index > 0)
        {   printf(", \"file\": ");
            json_print_abs_path(
                InputFiles[symbols[sym].line.file_index - 1].filename);
            printf(", \"line\": %d",
                (int)symbols[sym].line.line_number);
        }
        json_print_symbol_doc(sym);
        printf("}");
    }
    printf("\n  ],\n");

    /* --- verbs --- */
    printf("  \"verbs\": [\n");
    first = TRUE;
    for (i = 0; i < no_Inform_verbs; i++)
    {   int wc, w;

        if (!first) printf(",\n");
        first = FALSE;

        printf("    {\"verb_num\": %d", i);

        /* Dictionary words for this verb */
        wc = index_get_verb_word_count(i);
        printf(", \"words\": [");
        for (w = 0; w < wc; w++)
        {   const char *word = index_get_verb_word(i, w);
            if (w > 0) printf(", ");
            if (word) json_print_escaped_string(word);
        }
        printf("]");

        /* Actions referenced by this verb's grammar lines */
        printf(", \"actions\": [");
        {   int li, act, prev_act = -1, act_first = TRUE;
            for (li = 0; li < Inform_verbs[i].lines; li++)
            {   int mark = Inform_verbs[i].l[li];
                if (!glulx_mode)
                {   act = (grammar_lines[mark] << 8)
                        | grammar_lines[mark+1];
                    act &= 0x3FF;
                }
                else
                {   act = (grammar_lines[mark] << 8)
                        | grammar_lines[mark+1];
                }
                if (act != prev_act && act < no_actions)
                {   char action_name[256];
                    const char *name = symbols[actions[act].symbol].name;
                    int nlen;
                    if (!act_first) printf(", ");
                    /* Strip __A suffix from action names */
                    nlen = strlen(name);
                    if (nlen > 3 && nlen < 256
                        && strcmp(name + nlen - 3, "__A") == 0)
                    {   memcpy(action_name, name, nlen - 3);
                        action_name[nlen - 3] = '\0';
                        name = action_name;
                    }
                    json_print_escaped_string(name);
                    act_first = FALSE;
                    prev_act = act;
                }
            }
        }
        printf("]");

        if (Inform_verbs[i].line.file_index > 0)
        {   printf(", \"file\": ");
            json_print_abs_path(
                InputFiles[Inform_verbs[i].line.file_index - 1].filename);
            printf(", \"line\": %d",
                (int)Inform_verbs[i].line.line_number);
        }
        printf("}");
    }
    printf("\n  ],\n");

    /* --- dictionary --- */
    {   int ndict = index_get_dict_entry_count();
        printf("  \"dictionary\": [\n");
        first = TRUE;
        for (i = 0; i < ndict; i++)
        {   char word[64];
            int flags;
            index_get_dict_entry(i, word, sizeof(word), &flags);

            if (!first) printf(",\n");
            first = FALSE;

            printf("    {\"word\": ");
            json_print_escaped_string(word);
            if (flags & NOUN_DFLAG) printf(", \"noun\": true");
            if (flags & VERB_DFLAG) printf(", \"verb\": true");
            if (flags & PREP_DFLAG) printf(", \"preposition\": true");
            if (flags & META_DFLAG) printf(", \"meta\": true");
            if (flags & PLURAL_DFLAG) printf(", \"plural\": true");
            printf("}");
        }
        printf("\n  ],\n");
    }

    /* --- errors --- */
    printf("  \"errors\": [\n");
    first = TRUE;
    for (i = 0; i < errors_info_count; i++)
    {   index_error *e = &errors_info[i];
        const char *sev;

        if (!first) printf(",\n");
        first = FALSE;

        printf("    {");
        if (e->file)
        {   printf("\"file\": ");
            json_print_abs_path(e->file);
            printf(", ");
        }
        printf("\"line\": %d", (int)e->line);
        printf(", \"message\": ");
        json_print_escaped_string(e->message);

        switch (e->severity)
        {   case 1: sev = "error"; break;
            case 2: sev = "warning"; break;
            case 3: sev = "error"; break;
            case 4: sev = "fatal"; break;
            default: sev = "error"; break;
        }
        printf(", \"severity\": \"%s\"", sev);
        printf("}");
    }
    printf("\n  ],\n");

    /* --- includes --- */
    printf("  \"includes\": [\n");
    first = TRUE;
    for (i = 0; i < includes_count; i++)
    {   index_include *inc = &includes_info[i];
        if (!first) printf(",\n");
        first = FALSE;
        printf("    {\"from_file\": ");
        json_print_abs_path(inc->from_file);
        printf(", \"from_line\": %d, \"from_col\": %d",
            (int)inc->from_line, (int)inc->from_col);
        printf(", \"given\": ");
        json_print_escaped_string(inc->given);
        printf(", \"resolved\": ");
        json_print_abs_path(inc->resolved);
        printf(", \"file_index\": %d}", inc->file_index);
    }
    printf("\n  ],\n");

    /* --- references --- */
    qsort(sym_refs, sym_refs_count, sizeof(index_sym_ref), compare_sym_refs);
    printf("  \"references\": [\n");
    first = TRUE;
    {   int si = 0;
        while (si < sym_refs_count)
        {   int sym = sym_refs[si].symbol_index;
            const char *sym_name = symbols[sym].name;
            const char *type_str;
            int nlen = strlen(sym_name);
            int loc_first;
            int32 prev_file, prev_line, prev_col;
            char stripped_name[256];

            if (!first) printf(",\n");
            first = FALSE;

            /* Detect action symbols: name ends with __A and has ACTION_SFLAG
               or is FAKE_ACTION_T */
            if (nlen > 3 && strcmp(sym_name + nlen - 3, "__A") == 0
                && ((symbols[sym].flags & ACTION_SFLAG)
                    || symbols[sym].type == FAKE_ACTION_T))
            {   if (nlen - 3 < (int)sizeof(stripped_name))
                {   memcpy(stripped_name, sym_name, nlen - 3);
                    stripped_name[nlen - 3] = '\0';
                    sym_name = stripped_name;
                }
                type_str = "action";
            }
            else
                type_str = symbol_type_name(symbols[sym].type);

            printf("    {\"sym\": ");
            json_print_escaped_string(sym_name);
            printf(", \"type\": \"%s\", \"locs\": [", type_str);

            loc_first = TRUE;
            prev_file = -1; prev_line = -1; prev_col = -1;
            while (si < sym_refs_count && sym_refs[si].symbol_index == sym)
            {   /* Skip exact duplicate locs (put-back tokens can double-fire) */
                if (sym_refs[si].file_index != prev_file
                    || sym_refs[si].line != prev_line
                    || sym_refs[si].col != prev_col)
                {   if (!loc_first) printf(", ");
                    loc_first = FALSE;
                    printf("\"%d:%d:%d\"",
                        (int)sym_refs[si].file_index - 1,
                        (int)sym_refs[si].line,
                        (int)sym_refs[si].col);
                    prev_file = sym_refs[si].file_index;
                    prev_line = sym_refs[si].line;
                    prev_col  = sym_refs[si].col;
                }
                si++;
            }
            printf("]}");
        }
    }
    printf("\n  ],\n");

    /* --- conditionals --- */
    printf("  \"conditionals\": [\n");
    first = TRUE;
    for (i = 0; i < conditionals_count; i++)
    {   index_conditional *c = &conditionals[i];
        const char *active;
        if (c->end_line == 0) continue;   /* unterminated (e.g. EOF) */
        /* Skip conditionals from veneer routines (file_index == 255) and
           any out-of-range file index — those aren't from real source. */
        if (c->file_index < 1 || c->file_index > total_input_files) continue;
        if (!first) printf(",\n");
        first = FALSE;
        printf("    {\"directive\": \"%s\"",
            cond_directive_name(c->directive));
        printf(", \"file\": ");
        json_print_abs_path(InputFiles[c->file_index - 1].filename);
        printf(", \"start_line\": %d, \"start_col\": %d",
            (int)c->start_line, (int)c->start_col);
        if (c->else_line > 0)
            printf(", \"else_line\": %d, \"else_col\": %d",
                (int)c->else_line, (int)c->else_col);
        printf(", \"end_line\": %d, \"end_col\": %d",
            (int)c->end_line, (int)c->end_col);
        if (c->dead)
            active = "none";
        else if (c->taken)
            active = "if";
        else if (c->else_line > 0)
            active = "else";
        else
            active = "none";
        printf(", \"active\": \"%s\"", active);
        printf("}");
    }
    printf("\n  ]\n");

    printf("}\n");
}

/* ------------------------------------------------------------------------- */
/*   Lifecycle hooks (called from inform.c)                                  */
/* ------------------------------------------------------------------------- */

extern void init_index_vars(void)
{   routines_info = NULL;
    locals_pool = NULL;
    objects_info = NULL;
    obj_attrs_pool = NULL;
    obj_props_pool = NULL;
    obj_private_props_pool = NULL;
    pending_attrs = NULL;
    pending_props = NULL;
    pending_private_props = NULL;
    doc_buffer = NULL;
    trailing_doc_text = NULL;
    symbol_docs = NULL;
    formal_property_marks = NULL;
    trailing_docs = NULL;
    errors_info = NULL;
    includes_info = NULL;
    includes_count = 0;
    sym_refs = NULL;
    conditionals = NULL;
    conditionals_count = 0;
    cond_sp = 0;
    pending_object_doc = NULL;
    trailing_docs_count = 0;
    errors_info_count = 0;
    sym_refs_count = 0;
    routines_count = 0;
    locals_pool_count = 0;
    objects_info_count = 0;
    obj_attrs_pool_count = 0;
    obj_props_pool_count = 0;
    obj_private_props_pool_count = 0;
    pending_attrs_count = 0;
    pending_props_count = 0;
    pending_private_props_count = 0;
    doc_buffer_len = 0;
    doc_fresh = FALSE;
    trailing_doc_line = 0;
}

extern void index_begin_pass(void)
{   routines_count = 0;
    locals_pool_count = 0;
    objects_info_count = 0;
    obj_attrs_pool_count = 0;
    obj_props_pool_count = 0;
    obj_private_props_pool_count = 0;
    pending_attrs_count = 0;
    pending_props_count = 0;
    pending_private_props_count = 0;
    doc_buffer_len = 0;
    doc_fresh = FALSE;
    trailing_doc_line = 0;
    trailing_docs_count = 0;
    errors_info_count = 0;
    includes_count = 0;
    sym_refs_count = 0;
    conditionals_count = 0;
    cond_sp = 0;
}

extern void index_allocate_arrays(void)
{   initialise_memory_list(&routines_info_memlist,
        sizeof(index_routine), MAX_INDEX_ROUTINES,
        (void **)&routines_info, "index routines");
    initialise_memory_list(&locals_pool_memlist,
        sizeof(char *), MAX_INDEX_LOCALS_TOTAL,
        (void **)&locals_pool, "index locals pool");
    initialise_memory_list(&objects_info_memlist,
        sizeof(index_object), MAX_INDEX_OBJECTS,
        (void **)&objects_info, "index objects");
    initialise_memory_list(&obj_attrs_pool_memlist,
        sizeof(index_prop_entry), MAX_INDEX_OBJ_ATTRS,
        (void **)&obj_attrs_pool, "index object attrs");
    initialise_memory_list(&obj_props_pool_memlist,
        sizeof(index_prop_entry), MAX_INDEX_OBJ_PROPS,
        (void **)&obj_props_pool, "index object props");
    initialise_memory_list(&obj_private_props_pool_memlist,
        sizeof(index_prop_entry), MAX_INDEX_OBJ_PROPS,
        (void **)&obj_private_props_pool, "index object private props");
    initialise_memory_list(&pending_attrs_memlist,
        sizeof(index_prop_entry), 64,
        (void **)&pending_attrs, "index pending attrs");
    initialise_memory_list(&pending_props_memlist,
        sizeof(index_prop_entry), 64,
        (void **)&pending_props, "index pending props");
    initialise_memory_list(&pending_private_props_memlist,
        sizeof(index_prop_entry), 64,
        (void **)&pending_private_props, "index pending private props");
    initialise_memory_list(&doc_buffer_memlist,
        sizeof(char), MAX_DOC_BUFFER,
        (void **)&doc_buffer, "index doc buffer");
    initialise_memory_list(&trailing_doc_memlist,
        sizeof(char), 512,
        (void **)&trailing_doc_text, "index trailing doc");
    initialise_memory_list(&symbol_docs_memlist,
        sizeof(char *), MAX_SYMBOL_DOCS,
        (void **)&symbol_docs, "index symbol docs");
    initialise_memory_list(&formal_property_marks_memlist,
        sizeof(unsigned char), MAX_SYMBOL_DOCS,
        (void **)&formal_property_marks, "index formal property marks");
    initialise_memory_list(&trailing_docs_list_memlist,
        sizeof(trailing_doc_entry), MAX_TRAILING_DOCS,
        (void **)&trailing_docs, "index trailing docs");
    initialise_memory_list(&includes_memlist,
        sizeof(index_include), 64,
        (void **)&includes_info, "index includes");
    initialise_memory_list(&errors_info_memlist,
        sizeof(index_error), MAX_INDEX_ERRORS,
        (void **)&errors_info, "index errors");
    initialise_memory_list(&sym_refs_memlist,
        sizeof(index_sym_ref), 8192,
        (void **)&sym_refs, "index symbol refs");
    initialise_memory_list(&conditionals_memlist,
        sizeof(index_conditional), 256,
        (void **)&conditionals, "index conditionals");
}

extern void index_free_arrays(void)
{   int i;
    for (i = 0; i < routines_count; i++)
    {   free(routines_info[i].name);
        if (routines_info[i].doc) free(routines_info[i].doc);
    }
    for (i = 0; i < locals_pool_count; i++)
        free(locals_pool[i]);
    for (i = 0; i < objects_info_count; i++)
    {   free(objects_info[i].name);
        if (objects_info[i].shortname) free(objects_info[i].shortname);
        if (objects_info[i].doc) free(objects_info[i].doc);
    }
    for (i = 0; i < obj_attrs_pool_count; i++)
        free(obj_attrs_pool[i].name);
    for (i = 0; i < obj_props_pool_count; i++)
        free(obj_props_pool[i].name);
    for (i = 0; i < obj_private_props_pool_count; i++)
        free(obj_private_props_pool[i].name);
    /* pending pools are consumed by index_note_object, but clean up stragglers */
    for (i = 0; i < pending_attrs_count; i++)
        free(pending_attrs[i].name);
    for (i = 0; i < pending_props_count; i++)
        free(pending_props[i].name);
    for (i = 0; i < pending_private_props_count; i++)
        free(pending_private_props[i].name);
    for (i = 0; i < (int)symbol_docs_memlist.count; i++)
        if (symbol_docs[i]) free(symbol_docs[i]);
    for (i = 0; i < trailing_docs_count; i++)
        free(trailing_docs[i].text);
    for (i = 0; i < errors_info_count; i++)
    {   if (errors_info[i].file) free(errors_info[i].file);
        free(errors_info[i].message);
    }
    for (i = 0; i < includes_count; i++)
    {   free(includes_info[i].from_file);
        free(includes_info[i].given);
        free(includes_info[i].resolved);
    }
    if (pending_object_doc) free(pending_object_doc);
    deallocate_memory_list(&routines_info_memlist);
    deallocate_memory_list(&locals_pool_memlist);
    deallocate_memory_list(&objects_info_memlist);
    deallocate_memory_list(&obj_attrs_pool_memlist);
    deallocate_memory_list(&obj_props_pool_memlist);
    deallocate_memory_list(&obj_private_props_pool_memlist);
    deallocate_memory_list(&pending_attrs_memlist);
    deallocate_memory_list(&pending_props_memlist);
    deallocate_memory_list(&pending_private_props_memlist);
    deallocate_memory_list(&doc_buffer_memlist);
    deallocate_memory_list(&trailing_doc_memlist);
    deallocate_memory_list(&symbol_docs_memlist);
    deallocate_memory_list(&formal_property_marks_memlist);
    deallocate_memory_list(&trailing_docs_list_memlist);
    deallocate_memory_list(&errors_info_memlist);
    deallocate_memory_list(&includes_memlist);
    deallocate_memory_list(&sym_refs_memlist);
    deallocate_memory_list(&conditionals_memlist);
}
