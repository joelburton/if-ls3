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
    int locals_start;         /* index into locals_pool */
    int locals_count;
} index_routine;

static index_routine *routines_info;
static int routines_count;

static char **locals_pool;
static int locals_pool_count;

static memory_list routines_info_memlist;
static memory_list locals_pool_memlist;

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
    {   int len = strlen(name);
        char *copy = malloc(len + 1);
        if (!copy) fatalerror("out of memory in index_note_routine");
        memcpy(copy, name, len + 1);
        r->name = copy;
    }
    r->r_symbol = r_symbol;
    r->embedded = embedded_flag;
    r->line = get_brief_location(&ErrorReport);
    r->locals_start = locals_pool_count;
    r->locals_count = no_locals;

    ensure_memory_list_available(&locals_pool_memlist,
        locals_pool_count + no_locals);

    for (i = 0; i < no_locals; i++)
    {   char *src = get_local_variable_name(i);
        int len = strlen(src);
        char *copy = malloc(len + 1);
        if (!copy) fatalerror("out of memory in index_note_routine");
        memcpy(copy, src, len + 1);
        locals_pool[locals_pool_count + i] = copy;
    }

    locals_pool_count += no_locals;
    routines_count++;
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
            printf(", \"line\": %d",
                (int)r->line.line_number);
        }

        printf(", \"locals\": [");
        for (j = 0; j < r->locals_count; j++)
        {   if (j > 0) printf(", ");
            json_print_escaped_string(
                locals_pool[r->locals_start + j]);
        }
        printf("]}");
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
    routines_count = 0;
    locals_pool_count = 0;
}

extern void index_begin_pass(void)
{   routines_count = 0;
    locals_pool_count = 0;
}

extern void index_allocate_arrays(void)
{   initialise_memory_list(&routines_info_memlist,
        sizeof(index_routine), MAX_INDEX_ROUTINES,
        (void **)&routines_info, "index routines");
    initialise_memory_list(&locals_pool_memlist,
        sizeof(char *), MAX_INDEX_LOCALS_TOTAL,
        (void **)&locals_pool, "index locals pool");
}

extern void index_free_arrays(void)
{   int i;
    for (i = 0; i < routines_count; i++)
        free(routines_info[i].name);
    for (i = 0; i < locals_pool_count; i++)
        free(locals_pool[i]);
    deallocate_memory_list(&routines_info_memlist);
    deallocate_memory_list(&locals_pool_memlist);
}
