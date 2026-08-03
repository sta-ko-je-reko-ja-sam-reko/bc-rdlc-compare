namespace RepLayoutPreview;

using System.Reflection;

page 74753 "BCLP Field List API"
{
    PageType = API;
    Caption = 'Field';
    APIPublisher = 'RepLayoutPreview';
    APIGroup = 'layoutPreview';
    APIVersion = 'v1.0';
    EntityName = 'bcField';
    EntitySetName = 'bcFields';
    SourceTable = "Field";
    ODataKeyFields = SystemId;
    Extensible = false;
    Editable = false;
    InsertAllowed = false;
    ModifyAllowed = false;
    DeleteAllowed = false;

    layout
    {
        area(Content)
        {
            repeater(Group)
            {
                field(id; Rec.SystemId)
                {
                    Caption = 'Id';
                }
                field(tableNo; Rec.TableNo)
                {
                    Caption = 'Table No';
                }
                field(tableName; Rec.TableName)
                {
                    Caption = 'Table Name';
                }
                field(fieldNo; Rec."No.")
                {
                    Caption = 'Field No';
                }
                field(fieldName; Rec.FieldName)
                {
                    Caption = 'Field Name';
                }
                field(fieldCaption; Rec."Field Caption")
                {
                    Caption = 'Field Caption';
                }
                field(typeName; Rec."Type Name")
                {
                    Caption = 'Type Name';
                }
                field(fieldClass; Rec.Class)
                {
                    Caption = 'Class';
                }
                field(enabled; Rec.Enabled)
                {
                    Caption = 'Enabled';
                }
            }
        }
    }
}
