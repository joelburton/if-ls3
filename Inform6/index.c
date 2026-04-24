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
    int symbol;                /* symbol table index, or 0 */
    int is_class;              /* TRUE if defined via Class directive */
    int parent;                /* parent object number (0 = none) */
    brief_location line;       /* source location */
    int32 end_line;            /* line number of closing ; */
    int attrs_start;           /* index into obj_attrs_pool */
    int attrs_count;
    int props_start;           /* index into obj_props_pool */
    int props_count;
} index_object;

static index_object *objects_info;
static int objects_info_count;

static char **obj_attrs_pool;   /* attribute names */
static int obj_attrs_pool_count;

static char **obj_props_pool;   /* property names */
static int obj_props_pool_count;

static memory_list objects_info_memlist;
static memory_list obj_attrs_pool_memlist;
static memory_list obj_props_pool_memlist;

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

/* Pending attribute/property names for current object being parsed */
static char **pending_attrs;
static int pending_attrs_count;
static memory_list pending_attrs_memlist;

static char **pending_props;
static int pending_props_count;
static memory_list pending_props_memlist;

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

extern void index_reset_object_props(void)
{   pending_attrs_count = 0;
    pending_props_count = 0;
}

extern void index_note_attribute(char *name)
{   ensure_memory_list_available(&pending_attrs_memlist,
        pending_attrs_count + 1);
    pending_attrs[pending_attrs_count++] = index_strdup(name);
}

extern void index_note_property(char *name)
{   ensure_memory_list_available(&pending_props_memlist,
        pending_props_count + 1);
    pending_props[pending_props_count++] = index_strdup(name);
}

extern void index_note_object(char *name, int symbol, int is_class,
    int parent, brief_location start)
{   int i;
    index_object *o;
    brief_location loc = get_brief_location(&ErrorReport);

    ensure_memory_list_available(&objects_info_memlist,
        objects_info_count + 1);

    o = &objects_info[objects_info_count];
    o->name = index_strdup(name);
    o->symbol = symbol;
    o->is_class = is_class;
    o->parent = parent;
    o->line = start;
    o->end_line = loc.line_number;

    /* Copy pending attributes */
    o->attrs_start = obj_attrs_pool_count;
    o->attrs_count = pending_attrs_count;
    ensure_memory_list_available(&obj_attrs_pool_memlist,
        obj_attrs_pool_count + pending_attrs_count);
    for (i = 0; i < pending_attrs_count; i++)
        obj_attrs_pool[obj_attrs_pool_count + i] = pending_attrs[i];
    obj_attrs_pool_count += pending_attrs_count;

    /* Copy pending properties */
    o->props_start = obj_props_pool_count;
    o->props_count = pending_props_count;
    ensure_memory_list_available(&obj_props_pool_memlist,
        obj_props_pool_count + pending_props_count);
    for (i = 0; i < pending_props_count; i++)
        obj_props_pool[obj_props_pool_count + i] = pending_props[i];
    obj_props_pool_count += pending_props_count;

    pending_attrs_count = 0;
    pending_props_count = 0;

    objects_info_count++;
}

/* ------------------------------------------------------------------------- */
/*   JSON output                                                             */
/* ------------------------------------------------------------------------- */

extern void index_output_json(void)
{   int i, j, first;
    int is_sys;

    printf("{\n");

    /* --- files --- */
    printf("  \"files\": [\n");
    first = TRUE;
    for (i = 0; i < total_input_files; i++)
    {   if (!first) printf(",\n");
        printf("    ");
        json_print_escaped_string(InputFiles[i].filename);
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

        if (symbols[i].line.file_index > 0)
        {   printf(", \"file\": ");
            json_print_escaped_string(
                InputFiles[symbols[i].line.file_index - 1].filename);
            printf(", \"line\": %d",
                (int)symbols[i].line.line_number);
        }
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
            json_print_escaped_string(
                InputFiles[r->line.file_index - 1].filename);
            printf(", \"start_line\": %d",
                (int)r->line.line_number);
            if (r->end_line > 0)
                printf(", \"end_line\": %d", (int)r->end_line);
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

        if (o->is_class)
            printf(", \"is_class\": true");

        if (o->line.file_index > 0)
        {   printf(", \"file\": ");
            json_print_escaped_string(
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
        {   if (j > 0) printf(", ");
            json_print_escaped_string(
                obj_attrs_pool[o->attrs_start + j]);
        }
        printf("]");

        printf(", \"properties\": [");
        for (j = 0; j < o->props_count; j++)
        {   if (j > 0) printf(", ");
            json_print_escaped_string(
                obj_props_pool[o->props_start + j]);
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
            json_print_escaped_string(
                InputFiles[symbols[i].line.file_index - 1].filename);
            printf(", \"line\": %d",
                (int)symbols[i].line.line_number);
        }
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
            json_print_escaped_string(
                InputFiles[symbols[sym].line.file_index - 1].filename);
            printf(", \"line\": %d",
                (int)symbols[sym].line.line_number);
        }
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
    pending_attrs = NULL;
    pending_props = NULL;
    routines_count = 0;
    locals_pool_count = 0;
    objects_info_count = 0;
    obj_attrs_pool_count = 0;
    obj_props_pool_count = 0;
    pending_attrs_count = 0;
    pending_props_count = 0;
}

extern void index_begin_pass(void)
{   routines_count = 0;
    locals_pool_count = 0;
    objects_info_count = 0;
    obj_attrs_pool_count = 0;
    obj_props_pool_count = 0;
    pending_attrs_count = 0;
    pending_props_count = 0;
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
        sizeof(char *), MAX_INDEX_OBJ_ATTRS,
        (void **)&obj_attrs_pool, "index object attrs");
    initialise_memory_list(&obj_props_pool_memlist,
        sizeof(char *), MAX_INDEX_OBJ_PROPS,
        (void **)&obj_props_pool, "index object props");
    initialise_memory_list(&pending_attrs_memlist,
        sizeof(char *), 64,
        (void **)&pending_attrs, "index pending attrs");
    initialise_memory_list(&pending_props_memlist,
        sizeof(char *), 64,
        (void **)&pending_props, "index pending props");
}

extern void index_free_arrays(void)
{   int i;
    for (i = 0; i < routines_count; i++)
        free(routines_info[i].name);
    for (i = 0; i < locals_pool_count; i++)
        free(locals_pool[i]);
    for (i = 0; i < objects_info_count; i++)
        free(objects_info[i].name);
    for (i = 0; i < obj_attrs_pool_count; i++)
        free(obj_attrs_pool[i]);
    for (i = 0; i < obj_props_pool_count; i++)
        free(obj_props_pool[i]);
    /* pending pools are consumed by index_note_object, but clean up stragglers */
    for (i = 0; i < pending_attrs_count; i++)
        free(pending_attrs[i]);
    for (i = 0; i < pending_props_count; i++)
        free(pending_props[i]);
    deallocate_memory_list(&routines_info_memlist);
    deallocate_memory_list(&locals_pool_memlist);
    deallocate_memory_list(&objects_info_memlist);
    deallocate_memory_list(&obj_attrs_pool_memlist);
    deallocate_memory_list(&obj_props_pool_memlist);
    deallocate_memory_list(&pending_attrs_memlist);
    deallocate_memory_list(&pending_props_memlist);
}
