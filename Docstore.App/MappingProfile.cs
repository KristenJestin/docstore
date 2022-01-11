using AutoMapper;
using Docstore.Domain.Entities;
using Docstore.App.Models.Forms;

namespace Docstore.App
{
    public class MappingProfile : Profile
    {
        public MappingProfile()
        {
            CreateMap<DocumentCreateForm, Document>()
                .ForMember(x => x.Files, act => act.Ignore())
                .ForMember(x => x.Tags, act => act.Ignore());

            CreateMap<FolderCreateForm, Folder>();
        }
    }
}
